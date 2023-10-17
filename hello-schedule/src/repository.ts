import { Database } from '@bahag/npm-cloud-sql-wrapper';
import { DbConfig } from '@bahag/npm-cloud-sql-wrapper/lib/interfaces';
import { Logger } from '@bahag/npm-structured-logger';
import * as fs from 'fs';
import { Knex } from 'knex';
import * as path from 'path';
import { Status, SupplierState, SupplierStateDB, TransmissionLogs } from './interface/interfaces';

export class Repository {
    private pool: Knex;
    private database: Database;
    private logger: Logger;
    private readonly INVRPT_SCHEMA = 'invrpt';
    private supplierStates: SupplierState[];

    constructor() {
        this.database = new Database();
        this.logger = Logger.getInstance();
    }

    async createPool(): Promise<void> {
        this.pool = await this.database.getPool(Repository.getDbConfig());
    }

    async teardown(): Promise<void> {
        await this.pool.destroy();
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public async addTransmission(transmissionLogs: TransmissionLogs): Promise<any> {
        /* eslint-disable camelcase */
        const query = this.pool
            .withSchema(this.INVRPT_SCHEMA)
            .table('transmission_log')
            .insert({
                transmission_timestamp: transmissionLogs.transmissionTimestamp,
                supplier_key_account_number: transmissionLogs.supplierNumber,
                status: transmissionLogs.status,
                inbound_channel: transmissionLogs.inboundChannel,
                inbound_method: transmissionLogs.inboundMethod
            })
            /* eslint-enable camelcase */
            .returning('id');
        return query.catch((err) => {
            this.logger.logError(`Error storing transmission for ${transmissionLogs.supplierNumber} at ${transmissionLogs.transmissionTimestamp} into DB.: ${err}`, 'sftp-collector');
        });
    }

    public async updateTransmission(id: number, status: Status, storagePath: string): Promise<void> {
        /* eslint-disable camelcase */
        const query = this.pool
            .withSchema(this.INVRPT_SCHEMA)
            .table('transmission_log')
            .update({
                status: status,
                storage_path: storagePath,
            })
            /* eslint-enable camelcase */
            .where('id', id)
            .onConflict('id')
            .merge();
        await query.catch((err) => {
            this.logger.logError(`Error updating transmission ${id}: ${err}`, 'sftp-collector');
        });
    }

    public async requestSupplierStates(): Promise<void> {
        const query = this.pool
            .withSchema(this.INVRPT_SCHEMA)
            .table('supplier_state')
            .select('state', 'supplier_number', 'inbound_channel', 'country');
        return query.catch((err) => {
            this.logger.logError(`Error getting supplier states: ${err}`, 'sftp-collector');
            throw err;
        })
            .then((supplierStates: SupplierStateDB[]) => {
                this.supplierStates = supplierStates.map((supplierState) => {
                    return {
                        supplierId: supplierState.supplier_number,
                        state: supplierState.state,
                        countryCode: supplierState.country,
                        inboundChannel: supplierState.inbound_channel
                    };
                });
            });
    }

    public async getSupplierState(supplierId: string, country: string, inboundChannel: string): Promise<boolean> {
        const foundSupplierState = this.supplierStates.find((supplierState) => {
            return supplierState.supplierId === supplierId
                && supplierState.inboundChannel === inboundChannel
                && supplierState.countryCode === country;
        });
        if (foundSupplierState) {
            return foundSupplierState.state === 1;
        }
        else {
            await this.addNewSupplier(supplierId, country, inboundChannel);
            return false;
        }
    }

    public async addNewSupplier(supplierId: string, country: string, inboundChannel: string): Promise<void> {
        /* eslint-disable camelcase */
        const query = this.pool
            .withSchema(this.INVRPT_SCHEMA)
            .table('supplier_state')
            .insert({
                supplier_number: supplierId,
                country: country,
                state: null,
                inbound_channel: inboundChannel
            });
        /* eslint-enable camelcase */
        await query.catch((err) => {
            this.logger.logError(`Error creating ${inboundChannel} supplier ${supplierId} for country ${country}: ${err}`, 'sftp-collector');
        }).then(() => {
            this.logger.logNotice(`Added new ${inboundChannel} supplier ${supplierId} for country ${country} to supplier_states`, 'sftp-collector');
        });
    }

    private static getDbConfig(): DbConfig {
        return {
            tableName: 'document',
            schema: 'invrpt',
            knexConfig: {
                client: 'pg',
                connection: {
                    user: process.env.API_DB_USER as string,
                    password: process.env.API_DB_PASSWORD as string,
                    database: process.env.API_DB_NAME as string,
                    host: process.env.DB_PRIVATE_IP as string,
                    port: 5432,
                    ssl: {
                        rejectUnauthorized: false,
                        ca: fs.readFileSync(path.resolve(`ssl/${process.env.environment}/server-ca.pem`)),
                        key: fs.readFileSync(path.resolve(`ssl/${process.env.environment}/client-key.pem`)),
                        cert: fs.readFileSync(path.resolve(`ssl/${process.env.environment}/client-cert.pem`))
                    },
                    pool: {
                        min: 1,
                        max: 1
                    },
                    // eslint-disable-next-line camelcase
                    application_name: 'sftp-collector'
                }
            }
        };
    }
}
