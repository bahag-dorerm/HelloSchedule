import { Logger } from '@bahag/npm-structured-logger';
import { Context } from './context';
import { PubsubEvent, Status } from './interface/interfaces';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function collectFromSftp(_: PubsubEvent): Promise<void> {
    const context = new Context();
    await context.setup();
    const supplierFolders = await context.getSupplierFolders();
    const supplierWorkers: Promise<void>[] = [];

    for (const supplierFolder of supplierFolders) {
        if (!context.ignoredFolders.includes(supplierFolder)) {
            supplierWorkers.push(collectFilesFromSftpBySupplierId(supplierFolder, context));
        }
    }
    await Promise.allSettled(supplierWorkers).then(() => context.teardown());
}

async function collectFilesFromSftpBySupplierId(supplierFolder: string, context: Context): Promise<void> {
    const fileNames = await context.getFileList(supplierFolder);
    for (const fileName of fileNames) {
        await handleFile(fileName, supplierFolder, context);
        await context.deleteOutdatedFiles(fileName, supplierFolder);
    }
}

async function handleFile(fileName: string, supplierFolder: string, context: Context): Promise<void> {
    const logging = Logger.getInstance();
    const supplierId = context.getSupplierId(fileName, supplierFolder);
    if (await context.validateFile(fileName, supplierFolder, supplierId)) {
        const transmissionId = await context.addTransmission(supplierId, fileName, supplierFolder);
        await context
            .copyFileToBucket(supplierFolder, fileName, transmissionId)
            .then((filePath: string) => context.updateTransmission(transmissionId, filePath, Status.SUCCESS))
            .then(() => context.deleteFileFromSftp(supplierFolder, fileName))
            .then((deletionResult) => logging.logNotice(deletionResult, 'sftp-collector'))
            .catch((err) => {
                logging.logError(err.message, 'sftp-collector');
                if (err.message.startsWith('Error writing file to storage: ')) {
                    context.updateTransmission(transmissionId, 'NA', Status.FAILED);
                }
            });
    }
}
