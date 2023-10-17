import SftpClient, { FileInfo, FileStats } from 'ssh2-sftp-client';
import { Firestore } from '@google-cloud/firestore';
import { Logger, Reporter } from '@bahag/npm-structured-logger';
import { createWritable } from '@bahag/npm-cloud-storage-wrapper';

import {
    BucketFileInfo,
    DEFAULT_MAIL_PROPERTIES,
    DynamicTemplateData,
    MailPubSubData,
    Status,
    SupplierInfo,
    TeamsAlertInfo,
    TransmissionLogs
} from './interface/interfaces';
import { Repository } from './repository';
import { fetchRetry } from './retry-fetch';
import { Publisher } from './publisher';

/* eslint-disable no-magic-numbers */
export class Context {
    private readonly DGE_PATH = '/EAI/s_ds-inventory-inbox_p/data/';
    private readonly ERROR_PREFIX = 'ERROR_';
    private readonly UNAUTHORIZED_PREFIX = 'UNAUTHORIZED_';
    private readonly MAX_ATTEMPTS_FOR_WRITING_TO_BUCKET = 3;
    private readonly SIZE_EMPTY_FILE = 0;
    public currentWriteToBucketAttempt = 1;
    public minimumFileAge = 30 * 1000; // 30 second
    public maximumFileAge = 6 * 604800 * 1000; // 6 weeks
    private repository: Repository;
    private sftp = new SftpClient();
    public internalFolderExceptions: Array<string>;
    public ignoredFolders: Array<string>;
    private readonly supplierNumberLength = 6;
    private readonly HTTP_RESPONSE_STATUS_OK = 200;

    public async setup(): Promise<void> {
        this.setFolderExceptions();
        await this.connectToDB();
        await this.sftp.connect({
            host: 'dge.bahag.com',
            username: process.env.SFTP_USER_NAME,
            password: process.env.SFTP_PASSWORD
        }).catch((err: Error) => {
            Logger.getInstance().logError(err.message, 'sftp-collector');
        });
        await this.repository.requestSupplierStates();
    }

    public async teardown(): Promise<void> {
        await this.sftp.end();
        await this.repository.teardown();
    }

    private async connectToDB(): Promise<void> {
        this.repository = new Repository();
        await this.repository.createPool();
    }

    public getSupplierId(fileName: string, supplierFolder: string): string {
        if (this.internalFolderExceptions.includes(supplierFolder)) {
            const extractedId = fileName.match(/_\d+_/g);
            if (extractedId) {
                const frameLength = 1;
                return extractedId[0].slice(frameLength, -frameLength);
            }
        }
        return supplierFolder;
    }

    private setFolderExceptions(): void {
        if (process.env.environment === 'prod') {
            this.internalFolderExceptions = ['s_sm-ds_p'];
            this.ignoredFolders = ['s_ds-test-supplier_p', 's_sm-ds_t'];
        }
        else {
            this.internalFolderExceptions = ['s_ds-test-supplier_p', 's_sm-ds_t'];
            this.ignoredFolders = ['s_sm-ds_p'];
        }
    }

    public async validateFile(fileName: string, supplierFolder: string, supplierId: string): Promise<boolean> {
        return await this.validateFileAge(fileName, supplierFolder)
            && await this.validateFileName(fileName, supplierFolder, supplierId)
            && await this.validateFileSize(fileName, supplierFolder, supplierId)
            && this.validateSupplier(fileName, supplierId, supplierFolder);
    }

    // eslint-disable-next-line max-lines-per-function,complexity
    private async validateFileName(fileName: string, supplierFolder: string, supplierId: string): Promise<boolean> {
        const pathRegExp = /^stock_(?<supplierId>\d+)_(?<countryCode>[A-Z]{2})_(?<timestamp>\d{14})\.(csv|xlsx)$/i;
        const regExpResult = pathRegExp.exec(fileName);
        const timestampValid = this.checkTimestamp(regExpResult?.groups?.timestamp);
        if (regExpResult && timestampValid) {
            return true;
        }
        if (!(fileName.startsWith(this.ERROR_PREFIX) || fileName.startsWith(this.UNAUTHORIZED_PREFIX))) {
            if (timestampValid) {
                await Reporter.getInstance().teamsError(`Invalid file name ${fileName} in folder ${supplierFolder}`, {
                    alert: 'Invalid file name on DGE',
                    project: process.env.project_id as string,
                    variables: [{
                        name: 'File Name',
                        value: fileName,
                    }, {
                        name: 'Folder Name',
                        value: supplierFolder,
                    }],
                    storageUrl: true,
                    logUrl: true
                }, 'sftp-collector');
            }
            const errorFileName = `${this.ERROR_PREFIX}${fileName}`;
            await this.renameFileOnSftp(supplierFolder, fileName, errorFileName);
            //subject: Invalid file name on DGE ${fileName}
            let message = `Der Dateiname ${fileName} bei der Ablage auf dem SFTP-Server entspricht nicht dem erwarteten Schema: stock_{supplierID}_{country}_{dateTime}.{ending}`;
            if (!timestampValid) {
                message += ` Die Zeitangabe ${regExpResult?.groups?.timestamp} ist ungültig. Die Eingabe muss ein gültiges Datum im Format YYYYMMDDHHMMSS beinhalten. Bitte prüfen Sie die Angaben.`;
            }
            const subject = 'Fehler Bestandsmeldung Dropshipping - Dateiname';
            const supplierInfo = await this.getSupplierInfo(supplierId);
            const country = this.getCountry(fileName);
            const dynamicTemplateData = this.getDynamicTemplateData(supplierId, supplierInfo, subject, country, fileName, message);
            const pubSubData: MailPubSubData = {
                subject: subject,
                supplierEmail: supplierInfo.email,
                dynamicTemplateData: dynamicTemplateData,
                mailType: 'file'
            };
            await Publisher.getInstance().publishToMailSender(pubSubData);
        }
        return false;
    }

    // eslint-disable-next-line max-params
    private getDynamicTemplateData(supplierId: string, supplierInfo: SupplierInfo, subject: string, country: string, file: string, error: string): DynamicTemplateData {
        return {
            supplierNumber: supplierId,
            supplierName: supplierInfo.name,
            subject: subject,
            project: 'ds-inventory',
            time: new Date().toLocaleString(),
            country: country,
            file: file,
            error: error
        } as DynamicTemplateData;
    }

    private getCountry(fileName: string): string {
        const country = fileName.match(/[A-Z]{2}/g);
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        return country !== null ? country![0] : '';
    }

    async getSupplierInfo(_supplierId: string): Promise<SupplierInfo> {
        const url = process.env.SUPPLIER_MASTERDATA_SERVICE_URL + `/${_supplierId}`;
        Logger.getInstance().logNotice('Type: getSupplierInfo');
        const requestToken = await this.getAuthToken();
        const requestHeaders = { Authorization: `Bearer ${requestToken}` };
        const response = await fetchRetry(
            {
                url: url,
                method: 'GET',
                headers: requestHeaders
            }, 'getSupplierInfo', Logger.getInstance())
            .then((response) => {
                if (response.status === this.HTTP_RESPONSE_STATUS_OK) {
                    Logger.getInstance().logNotice(`getSupplierInfo finished with response code: ${response.status}`);
                    return response.json();
                }
                else {
                    Logger.getInstance().logError(`Response Status Code from getSupplierInfo by Country API Call: ${response.status}`);
                    throw new Error();
                }
            });
        const supplierEmail = await this.getSupplierEmail(_supplierId);
        return { email: supplierEmail, name: response.name ? response.name : '' } as SupplierInfo;
    }

    async getSupplierEmail(supplierId: string): Promise<string> {
        const firestore = new Firestore({ projectId: process.env.ORDERSTATUS_PROJECT_ID });
        const suppRef = await firestore.collection('dropshippingSuppliers').doc(supplierId);
        const doc = await suppRef.get();
        let mail = '';
        if (!doc.exists) {
            Logger.getInstance().logError(`No such document: ${supplierId}`);
            throw new Error();
        }
        else {
            mail = doc.data()?.emailInvrpt;
            if (!mail) {
                mail = DEFAULT_MAIL_PROPERTIES.supplierManagement;
            }
        }
        await firestore.terminate();
        return mail;
    }

    // eslint-disable-next-line max-lines-per-function
    async getAuthToken(): Promise<string> {
        const logger = Logger.getInstance();
        const details: { [key: string]: string } = {
            'grant_type': 'client_credentials'
        };
        const formBody = Object.keys(details).map((key) => encodeURIComponent(key) + '=' + encodeURIComponent(details[key])).join('&');
        return await fetchRetry(
            {
                url: `${process.env.OAUTH_URL}`,
                method: 'POST',
                headers: {
                    'Accept-Encoding': 'gzip,deflate,compress',
                    'Accept': '*/*',
                    'Metadata-Flavor': 'Google',
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Authorization': 'Basic ' + Buffer.from(process.env.OAUTH_USERNAME + ':' + process.env.OAUTH_PASSWORD, 'binary').toString('base64')
                },
                body: formBody
            }, 'getAuthToken', Logger.getInstance())
            .then(
                async (response) => {
                    if (response.status === this.HTTP_RESPONSE_STATUS_OK) {
                        Logger.getInstance().logNotice(`Token request finished with response code: ${response.status}`);
                        return await response.text().then(async (body) => {
                            const parsedBody = JSON.parse(body);
                            return parsedBody.access_token;
                        });
                    }
                    else {
                        Logger.getInstance().logError(`Token Request Call Response Code: ${response.status}`);
                        throw new Error('Could not retrieve ID token');
                    }
                })
            .catch((error) => {
                logger.logError(error.message);
                throw error;
            });
    }

    private async validateFileSize(fileName: string, supplierFolder: string, supplierId: string): Promise<boolean> {
        const fileSize = await this.sftp.stat(`${this.DGE_PATH}${supplierFolder}/data/${fileName}`).then(
            (stats: FileStats) => {
                return stats.size;
            });
        if (fileSize === this.SIZE_EMPTY_FILE) {
            Logger.getInstance().logNotice(`File ${fileName} has a file size of zero`, 'sftp-collector');
            await this.deleteFileFromSftp(supplierFolder, fileName, true);
            //subject: File size validation failed
            const message = `Die Datei ${fileName} hat eine Dateigröße von Null`;
            const subject = 'Fehler Bestandsmeldung Dropshipping - Dateigröße';
            const supplierInfo = await this.getSupplierInfo(supplierId);
            const country = this.getCountry(fileName);
            const dynamicTemplateData = this.getDynamicTemplateData(supplierId, supplierInfo, subject, country, fileName, message);
            const pubSubData: MailPubSubData = {
                subject: subject,
                supplierEmail: supplierInfo.email,
                dynamicTemplateData: dynamicTemplateData,
                mailType: 'file'
            };
            await Publisher.getInstance().publishToMailSender(pubSubData);
            return false;
        }
        return true;
    }

    private async validateFileAge(fileName: string, supplierFolder: string): Promise<boolean> {
        if (!(process.env.environment === 'dev')) {
            const currentTime = new Date().getTime();
            const fileModificationTime = await this.sftp.stat(`${this.DGE_PATH}${supplierFolder}/data/${fileName}`).then(
                (stats: FileStats) => {
                    return stats.modifyTime;
                });
            if ((currentTime - fileModificationTime) <= this.minimumFileAge) {
                Logger.getInstance().logNotice(`File ${fileName} is less than 20sec old`, 'sftp-collector');
                return false;
            }
        }
        return true;
    }

    public async deleteOutdatedFiles(fileName: string, supplierFolder: string): Promise<void> {
        const currentTime = new Date().getTime();
        const fileModificationTime = await this.sftp.stat(`${this.DGE_PATH}${supplierFolder}/data/${fileName}`).then(
            (stats: FileStats) => {
                return stats.modifyTime;
            });
        if ((currentTime - fileModificationTime) >= this.maximumFileAge) {
            Logger.getInstance().logNotice(`File ${fileName} is older than 6 weeks - file is being deleted`, 'sftp-collector');
            await this.deleteFileFromSftp(supplierFolder, fileName);
        }
    }

    // eslint-disable-next-line max-lines-per-function
    private async validateSupplier(fileName: string, supplierId: string, supplierFolder: string): Promise<boolean> {
        const country = fileName.match(/[A-Z]{2}/g);
        const inboundChannel = Context.getInboundChannel(fileName);
        if (fileName.includes(supplierId)) {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            if (await this.repository.getSupplierState(supplierId, country![0], inboundChannel)) {
                return true;
            }
            else {
                //message: Supplier ${supplierId} is not authorized to send ${fileName}
                const message = `Der Lieferant ${supplierId} ist nicht berechtigt, die Datei ${fileName} zu senden`;
                const subject = 'Fehler Bestandsmeldung Dropshipping - Lieferantenberechtigung';
                Logger.getInstance().logNotice(`Supplier ${supplierId} is not authorized to send ${fileName}`, 'sftp-collector');
                //rename file to prevent sending mails in loop for this case
                const unauthorizedFileName = `${this.UNAUTHORIZED_PREFIX}${fileName}`;
                await this.renameFileOnSftp(supplierFolder, fileName, unauthorizedFileName);
                //subject: Supplier validation failed
                const supplierInfo = await this.getSupplierInfo(supplierId);
                const country = this.getCountry(fileName);
                const dynamicTemplateData = this.getDynamicTemplateData(supplierId, supplierInfo, subject, country, fileName, message);
                const pubSubData: MailPubSubData = {
                    subject: subject,
                    supplierEmail: supplierInfo.email,
                    dynamicTemplateData: dynamicTemplateData,
                    mailType: 'file'
                };
                await Publisher.getInstance().publishToMailSender(pubSubData);
                return false;
            }
        }
        else {
            //message: Unexpected supplierId in ${fileName}, expected: ${supplierId}
            const message = `Unerwartete Lieferanten-ID in ${fileName}, erwartet: ${supplierId}`;
            const subject = 'Fehler Bestandsmeldung Dropshipping - LieferantenID';
            Logger.getInstance().logWarning(`Unexpected supplierId in ${fileName}, expected: ${supplierId}`, 'sftp-collector');
            //rename
            const errorFileName = `${this.ERROR_PREFIX}${fileName}`;
            await this.renameFileOnSftp(supplierFolder, fileName, errorFileName);
            //subject: Supplier validation failed
            const supplierInfo = await this.getSupplierInfo(supplierId);
            const country = this.getCountry(fileName);
            const dynamicTemplateData = this.getDynamicTemplateData(supplierId, supplierInfo, subject, country, fileName, message);
            const pubSubData: MailPubSubData = {
                subject: subject,
                supplierEmail: DEFAULT_MAIL_PROPERTIES.supplierManagement,
                dynamicTemplateData: dynamicTemplateData,
                mailType: 'file'
            };
            await Publisher.getInstance().publishToMailSender(pubSubData);
            return false;
        }
    }

    private static getInboundChannel(fileName: string): string {
        return fileName
            .match(/\.(?<extension>[^.]+)$/i)
            ?.groups
            ?.extension
            ?.toLowerCase() as string;
    }

    public async addTransmission(supplierId: string, fileName: string, supplierFolder: string): Promise<number> {
        const log: TransmissionLogs = {
            transmissionTimestamp: new Date(),
            supplierNumber: supplierId,
            status: Status.INITIATED,
            inboundChannel: Context.getInboundChannel(fileName),
            inboundMethod: this.getInboundMethod(supplierFolder)
        };
        const transmission: { id: number }[] = await this.repository.addTransmission(log).catch((err) => {
            Logger.getInstance().logError(err.message, 'sftp-collector');
            return [{ id: 0 }];
        });
        return transmission[0].id;
    }

    public async updateTransmission(transmissionId: number, filePath: string, status: Status): Promise<void> {
        return this.repository.updateTransmission(transmissionId, status, filePath);
    }

    public async getSupplierFolders(): Promise<string[]> {
        return this.sftp.list(this.DGE_PATH).then(
            (supplierList: FileInfo[]) => supplierList.map((fileInfo) => fileInfo.name)
                .filter((folderName) => process.env.environment === 'prod' || !/\d+/.test(folderName))
        );
    }

    public async getFileList(supplierFolder: string): Promise<string[]> {
        return this.sftp.list(`${this.DGE_PATH}${supplierFolder}/data`).then(
            (fileList: FileInfo[]) => fileList.map((fileInfo) => fileInfo.name)
        );
    }

    public async copyFileToBucket(supplierFolder: string, fileName: string, transmissionId: number): Promise<string> {
        const sftpFilePath = `${this.DGE_PATH}${supplierFolder}/data/${fileName}`;
        const bucket = Context.chooseBucket(fileName);
        const bucketFilePath = Context.getFilePath(fileName, this.getSupplierId(fileName, supplierFolder), transmissionId);
        const supplier = this.getSupplierId(fileName, supplierFolder);
        const fileInfo = {
            filePath: sftpFilePath,
            bucketFilePath,
            bucket
        } as BucketFileInfo;
        const teamsAlert = { supplier, fileName, folderName: supplierFolder } as TeamsAlertInfo;
        await this.writeFileWithRetry(fileInfo, teamsAlert);
        return `gs://${bucket}/${bucketFilePath}`;
    }

    private static chooseBucket(fileName: string): string {
        const csvRegExp = /.csv/ig;
        if (fileName.match(csvRegExp)) {
            return process.env.INBOUND_CSV_BUCKET_NAME as string;
        }
        else {
            return process.env.INBOUND_XLSX_BUCKET_NAME as string;
        }
    }

    private static getFilePath(fileName: string, supplierFolder: string, transmissionId: number): string {
        const csvRegExp = /.csv/ig;
        if (fileName.match(csvRegExp)) {
            const newFileName = fileName.slice(0, -(('.csv').length));
            return `${supplierFolder}/${newFileName}_${transmissionId}.csv`;
        }
        else {
            const newFileName = fileName.slice(0, -(('.xlsx').length));
            return `${supplierFolder}/${newFileName}_${transmissionId}.xlsx`;
        }
    }

    private async writeFileWithRetry(fileInfo: BucketFileInfo, teamsAlert: TeamsAlertInfo): Promise<void> {
        if (this.currentWriteToBucketAttempt <= this.MAX_ATTEMPTS_FOR_WRITING_TO_BUCKET) {
            try {
                await this.sftp.get(
                    fileInfo.filePath,
                    createWritable(fileInfo.bucketFilePath, fileInfo.bucket));
            }
            catch (error) {
                Logger.getInstance().logError(`${error.message} on ${this.currentWriteToBucketAttempt} attempt`, 'sftp-collector');
                this.currentWriteToBucketAttempt++;
                await this.writeFileWithRetry(fileInfo, teamsAlert);
            }
        }
        else {
            await this.sendTeamsAlert(teamsAlert);
            throw new Error(`Error writing file to storage: ${fileInfo.filePath}.`);
        }
    }

    private async sendTeamsAlert(teamsAlert: TeamsAlertInfo): Promise<void> {
        await Reporter.getInstance().teamsError(`Error writing file name ${teamsAlert.fileName} to folder ${teamsAlert.folderName}`, {
            alert: 'An error has occurred while writing file',
            project: process.env.project_id as string,
            variables: [{
                name: 'Supplier',
                value: teamsAlert.supplier,
            }, {
                name: 'File Name',
                value: teamsAlert.fileName,
            }, {
                name: 'Folder Name',
                value: teamsAlert.folderName,
            }],
            storageUrl: true,
            logUrl: true
        }, 'sftp-collector');
        Logger.getInstance().logWarning('Teams alert has sent successfully', 'sftp-collector');
    }

    public async deleteFileFromSftp(supplierFolder: string, fileName: string, noNonExistentFileError = false): Promise<string> {
        Logger.getInstance().logNotice(`Deleting ${supplierFolder}/${fileName}`, 'sftp-collector');
        return this.sftp.delete(`${this.DGE_PATH}${supplierFolder}/data/${fileName}`, noNonExistentFileError);
    }

    public async renameFileOnSftp(supplierFolder: string, fileNameOld: string, fileNameNew: string): Promise<void> {
        Logger.getInstance().logNotice(`Renaming ${supplierFolder}/${fileNameOld} to: ${fileNameNew}`, 'sftp-collector');
        await this.sftp.rename(`${this.DGE_PATH}${supplierFolder}/data/${fileNameOld}`,
            `${this.DGE_PATH}${supplierFolder}/data/${fileNameNew}`);
    }

    public getInboundMethod(supplierFolder: string): 'Upload' | 'SFTP' {
        if (/^\d+$/.test(supplierFolder) && supplierFolder.length === this.supplierNumberLength) {
            return 'SFTP';
        }
        else if (this.internalFolderExceptions.includes(supplierFolder)) {
            return 'Upload';
        }
        else {
            throw new Error(`Invalid supplierFolder: ${supplierFolder}`);
        }
    }

    // eslint-disable-next-line complexity
    public checkTimestamp(timestamp: string | undefined): boolean {
        if (!timestamp || timestamp.length !== 14) return false;

        const year = Number(timestamp.slice(0, 4));
        const month = Number(timestamp.slice(4, 6));
        const day = Number(timestamp.slice(6, 8));
        const hour = Number(timestamp.slice(8, 10));
        const minute = Number(timestamp.slice(10, 12));
        const seconds = Number(timestamp.slice(12, 14));

        return !(year < 2020 || year > 2030 ||
            month < 1 || month > 12 ||
            day < 1 || day > 31 ||
            hour < 0 || hour > 23 ||
            minute < 0 || minute > 59 ||
            seconds < 0 || seconds > 59);
    }
}
