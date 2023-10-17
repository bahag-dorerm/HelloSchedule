import { Logger } from '@bahag/npm-structured-logger';
import { MailPubSubData } from './interface/interfaces';
import { PubSub } from '@google-cloud/pubsub';

export class Publisher {
    private pubSubClient: PubSub;
    private static _instance: Publisher;
    public static getInstance(): Publisher {
        if (!this._instance) {
            this._instance = new Publisher();
        }
        return this._instance;
    }
    constructor() {
        if (!process.env.GENERAL_PROJECT_ID) {
            Logger.getInstance().logError('Missing environment variable: GENERAL_PROJECT_ID', 'sftp-collector');
            throw new Error('Missing environment variable: GENERAL_PROJECT_ID');
        }
        this.pubSubClient = new PubSub({ projectId: process.env.GENERAL_PROJECT_ID });
    }
    public async publishToMailSender(data: MailPubSubData): Promise<void> {
        const dataBuffer = Buffer.from(JSON.stringify(data));
        try {
            if (!process.env.MAIL_SENDER_TOPIC) {
                throw new Error('Missing environment variable: MAIL_SENDER_TOPIC');
            }
            await this.pubSubClient.topic(process.env.MAIL_SENDER_TOPIC).publishMessage({ data: dataBuffer });
        }
        catch (error) {
            Logger.getInstance().logError(`Error while publishing message to topic: ${error.message}`, 'sftp-collector');
        }
    }
}
