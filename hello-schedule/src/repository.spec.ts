import { Database } from '@bahag/npm-cloud-sql-wrapper';
import { Logger } from '@bahag/npm-structured-logger';
import { Knex } from 'knex';
import { Status, TransmissionLogs } from './interface/interfaces';
import { Repository } from './repository';

jest.mock('@bahag/npm-cloud-sql-wrapper');
jest.mock('knex');
jest.mock('@bahag/npm-structured-logger');

const mockedLogger = Logger as jest.MockedClass<typeof Logger>;
let repository: Repository;

const data: TransmissionLogs = {
    transmissionTimestamp: new Date(),
    supplierNumber: '123456',
    status: Status.INITIATED,
    inboundChannel: '123456',
    inboundMethod: 'SFTP',
};

describe('SourceRepository', () => {

    beforeEach(async () => {
        jest.restoreAllMocks();
        jest.resetAllMocks();
        process.env.PROJECT_ID = 'my-project';
        process.env.environment = 'test';
        (mockedLogger.getInstance as jest.MockedFunction<typeof mockedLogger.getInstance>).mockReturnValue(new Logger());
        repository = new Repository();
    });

    it('Should be constructed', () => {
        expect(new Repository()).toBeTruthy();
    });

    it('Should get pool', async () => {
        await repository.createPool();
        expect(Database.prototype.getPool).toHaveBeenCalledTimes(1);
    });

    it('addTransmission should return insert transmission successfully', async () => {
        const queryBuilder = {
            withSchema: jest.fn().mockReturnThis(),
            table: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            insert: jest.fn().mockReturnThis(),
            returning: jest.fn().mockResolvedValue(123),
            catch: jest.fn().mockReturnThis()
        };
        jest.spyOn(Database.prototype, 'getPool').mockResolvedValue(queryBuilder as unknown as Knex);
        await repository.createPool();

        const resultByCountry = await repository.addTransmission(data);
        expect(resultByCountry).toEqual(123);
        expect(Logger.getInstance('sftp-collector').logError).toHaveBeenCalledTimes(0);
    });

    it('addTransmission should an error on the execution query stage', async () => {
        const queryBuilder = {
            withSchema: jest.fn().mockReturnThis(),
            table: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            insert: jest.fn().mockReturnThis(),
            returning: jest.fn().mockRejectedValue(new Error())
        };
        jest.spyOn(Database.prototype, 'getPool').mockResolvedValue(queryBuilder as unknown as Knex);
        await repository.createPool();

        const resultByCountry = await repository.addTransmission(data);
        expect(resultByCountry).toBeUndefined();
        expect(Logger.getInstance('sftp-collector').logError)
            .toHaveBeenCalledWith(`Error storing transmission for ${data.supplierNumber} at ${data.transmissionTimestamp} into DB.: Error`, 'sftp-collector');
    });

    it('updateTransmission should update transmission successfully', async () => {
        const id = 123;
        const status = Status.FAILED;
        const storePath = '/abc/abc/abc';
        const queryBuilder = {
            withSchema: jest.fn().mockReturnThis(),
            table: jest.fn().mockReturnThis(),
            update: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            onConflict: jest.fn().mockReturnThis(),
            merge: jest.fn().mockReturnThis(),
            catch: jest.fn().mockReturnThis()
        };
        jest.spyOn(Database.prototype, 'getPool').mockResolvedValue(queryBuilder as unknown as Knex);
        await repository.createPool();

        const resultByCountry = await repository.updateTransmission(id, status, storePath);
        expect(resultByCountry).toBeUndefined();
        expect(Logger.getInstance('sftp-collector').logError).toHaveBeenCalledTimes(0);
    });

    it('updateTransmission should occur an error on the execution query stage', async () => {
        const id = 123;
        const status = Status.FAILED;
        const storePath = '/abc/abc/abc';
        const queryBuilder = {
            withSchema: jest.fn().mockReturnThis(),
            table: jest.fn().mockReturnThis(),
            update: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            onConflict: jest.fn().mockReturnThis(),
            merge: jest.fn().mockRejectedValue(new Error())
        };
        jest.spyOn(Database.prototype, 'getPool').mockResolvedValue(queryBuilder as unknown as Knex);
        await repository.createPool();

        const resultByCountry = await repository.updateTransmission(id, status, storePath);
        expect(resultByCountry).toBeUndefined();
        expect(Logger.getInstance('sftp-collector').logError)
            .toHaveBeenCalledWith('Error updating transmission 123: Error', 'sftp-collector');
    });

    it('getSupplierState should get state true or false and doesnt add new supplier when existing', async () => {
        const queryBuilder = {
            withSchema: jest.fn().mockReturnThis(),
            table: jest.fn().mockReturnThis(),
            select: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            andWhere: jest.fn().mockReturnThis(),
            catch: jest.fn().mockResolvedValue([
                {
                    supplier_number: '123456',
                    country: 'DE',
                    state: 1,
                    inbound_channel: 'csv'
                },
                {
                    supplier_number: '123457',
                    country: 'DE',
                    state: 0,
                    inbound_channel: 'csv'
                },
                {
                    supplier_number: '123458',
                    country: 'DE',
                    state: null,
                    inbound_channel: 'csv'
                },
                {
                    supplier_number: '123459',
                    country: 'DE',
                    state: undefined,
                    inbound_channel: 'csv'
                }
            ])
        };
        jest.spyOn(Database.prototype, 'getPool').mockResolvedValue(queryBuilder as unknown as Knex);
        await repository.createPool();
        await repository.requestSupplierStates();
        const resultPositive = await repository.getSupplierState('123456', 'DE', 'csv');
        const resultNegative1 = await repository.getSupplierState('123457', 'DE', 'csv');
        const resultNegative2 = await repository.getSupplierState('123458', 'DE', 'csv');
        const resultNegative3 = await repository.getSupplierState('123459', 'DE', 'csv');
        expect(resultPositive).toBeTruthy();
        expect(resultNegative1).toBeFalsy();
        expect(resultNegative2).toBeFalsy();
        expect(resultNegative3).toBeFalsy();
        expect(Logger.getInstance('sftp-collector').logError).toHaveBeenCalledTimes(0);
    });

    it('getSupplierState should get state and add new supplier successfully', async () => {
        const supplierId = '123456';
        const country = 'DE';
        const inboundChannel = 'csv';
        const queryBuilder = {
            withSchema: jest.fn().mockReturnThis(),
            table: jest.fn().mockReturnThis(),
            select: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            andWhere: jest.fn().mockReturnThis(),
            catch: jest.fn().mockResolvedValue([]),
            insert: jest.fn().mockResolvedValue(123),
        };
        jest.spyOn(Database.prototype, 'getPool').mockResolvedValue(queryBuilder as unknown as Knex);
        await repository.createPool();
        await repository.requestSupplierStates();

        const resultByCountry = await repository.getSupplierState(supplierId, country, inboundChannel);
        expect(queryBuilder.insert).toBeCalledWith({
            country: 'DE',
            inbound_channel: 'csv',
            state: null,
            supplier_number: '123456'
        });
        expect(resultByCountry).toBeFalsy();
        expect(Logger.getInstance('sftp-collector').logError).toHaveBeenCalledTimes(0);
    });

    it('requestSupplierState should occur an error while query is processing', async () => {
        const queryBuilder = {
            withSchema: jest.fn().mockReturnThis(),
            table: jest.fn().mockReturnThis(),
            select: jest.fn().mockRejectedValue(new Error('Error in DB')),
        };
        jest.spyOn(Database.prototype, 'getPool').mockResolvedValue(queryBuilder as unknown as Knex);
        await repository.createPool();

        //expect(async () => { await repository.requestSupplierStates(); }).toThrow('foo');
        await expect(repository.requestSupplierStates()).rejects.toThrow('Error in DB');
        //expect(Logger.getInstance('sftp-collector').logError)
        //    .toHaveBeenCalledWith(`Error getting supplier states: Error`, 'sftp-collector');
    });

    it('addNewSupplier should add new supplier successfully', async () => {
        const supplierId = '123';
        const country = 'DE';
        const inboundChannel = '/abc/abc/abc';
        const queryBuilder = {
            withSchema: jest.fn().mockReturnThis(),
            table: jest.fn().mockReturnThis(),
            insert: jest.fn().mockResolvedValue(123)
        };
        jest.spyOn(Database.prototype, 'getPool').mockResolvedValue(queryBuilder as unknown as Knex);
        await repository.createPool();

        const resultByCountry = await repository.addNewSupplier(supplierId, country, inboundChannel);
        expect(resultByCountry).toBeUndefined();
        expect(Logger.getInstance('sftp-collector').logNotice)
            .toHaveBeenCalledWith('Added new /abc/abc/abc supplier 123 for country DE to supplier_states', 'sftp-collector');
        expect(Logger.getInstance('sftp-collector').logError).toHaveBeenCalledTimes(0);
    });

    it('addNewSupplier should produce an error when adding new supplier is executed', async () => {
        const supplierId = '123';
        const country = 'DE';
        const inboundChannel = '/abc/abc/abc';
        const queryBuilder = {
            withSchema: jest.fn().mockReturnThis(),
            table: jest.fn().mockReturnThis(),
            insert: jest.fn().mockRejectedValue(new Error())
        };
        jest.spyOn(Database.prototype, 'getPool').mockResolvedValue(queryBuilder as unknown as Knex);
        await repository.createPool();

        const resultByCountry = await repository.addNewSupplier(supplierId, country, inboundChannel);
        expect(resultByCountry).toBeUndefined();
        expect(Logger.getInstance('sftp-collector').logError)
            .toHaveBeenCalledWith(`Error creating ${inboundChannel} supplier ${supplierId} for country ${country}: Error`, 'sftp-collector');
    });
});
