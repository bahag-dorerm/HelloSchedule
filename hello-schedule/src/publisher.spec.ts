import { DynamicTemplateData, MailPubSubData } from './interface/interfaces';
import { Logger } from '@bahag/npm-structured-logger';
import { PubSub, Topic } from '@google-cloud/pubsub';
import { Publisher } from './publisher';

jest.mock('@bahag/npm-structured-logger');
jest.mock('@google-cloud/pubsub');

let publisher: Publisher;
const mockedLogger = Logger as jest.MockedClass<typeof Logger>;
let pubSubData: MailPubSubData;

describe('Publisher', () => {

    beforeEach(() => {
        jest.restoreAllMocks();
        jest.resetAllMocks();
        delete process.env.GENERAL_PROJECT_ID;
        delete process.env.MAIL_SENDER_TOPIC;
        pubSubData = {
            subject: 'Subject',
            supplierEmail: 'supplier123@email.com',
            dynamicTemplateData: {} as DynamicTemplateData,
            mailType: 'file'
        };
        (mockedLogger.getInstance as jest.MockedFunction<typeof mockedLogger.getInstance>).mockReturnValue(new Logger());
    });

    it('Should call publishToMailSender once', async () => {
        process.env.GENERAL_PROJECT_ID = 'my-project';
        process.env.MAIL_SENDER_TOPIC = 'my-topic';
        publisher = new Publisher();
        const mockedPublishMessage = jest.fn().mockResolvedValue('message-id');
        jest.spyOn(PubSub.prototype, 'topic').mockImplementation(() => {
            return { publishMessage: mockedPublishMessage } as unknown as Topic;
        });

        await publisher.publishToMailSender(pubSubData);
        expect(PubSub.prototype.topic).toHaveBeenCalledTimes(1);
        expect(mockedPublishMessage).toHaveBeenCalledTimes(1);
        expect(mockedLogger.getInstance().logError).not.toHaveBeenCalled();
    });

    it('Should throw error when mail sender topic name is missing', async () => {
        process.env.GENERAL_PROJECT_ID = 'my-project';
        publisher = new Publisher();

        await publisher.publishToMailSender(pubSubData);
        expect(mockedLogger.getInstance().logError).toHaveBeenCalledTimes(1);
    });

    it('Should throw error when general project id is missing', async () => {
        expect(() => new Publisher()).toThrow(new Error('Missing environment variable: GENERAL_PROJECT_ID'));
        expect(mockedLogger.getInstance().logError).toHaveBeenCalledTimes(1);
    });

    it('Should return existent instance when there is instance already', async () => {
        process.env.GENERAL_PROJECT_ID = 'my-project';
        const publisher: Publisher = new Publisher();
        const instance: Publisher = Publisher.getInstance();
        expect(JSON.stringify(instance)).toEqual(JSON.stringify(publisher));
    });
});
