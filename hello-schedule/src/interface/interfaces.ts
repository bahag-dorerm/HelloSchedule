export interface PubsubEvent {
    eventId: string
    timestamp: Date // ISO 8601
    eventType: string
    resource: string
    data?: string
}

export class TransmissionLogs {
    transmissionTimestamp: Date; // ISO 8601
    supplierNumber: string;
    status: Status;
    inboundChannel: string;
    inboundMethod: 'Upload' | 'SFTP' | 'EDI';
}

export enum Status {
    INITIATED = 'INITIATED',
    SUCCESS = 'SUCCESS',
    FAILED = 'FAILED',
    AVAILABLE = 'AVAILABLE',
    NOT_AVAILABLE = 'NOT_AVAILABLE'
}

export interface SupplierState {
    supplierId: string;
    countryCode: string;
    state: number;
    inboundChannel: string;
}

export interface SupplierStateDB {
    supplier_number: string;
    country: string;
    state: number;
    inbound_channel: string;
}

export const DEFAULT_MAIL_PROPERTIES = {
    supplierManagement: 'supplier-management-strecke@bahag.com'
};

export interface SupplierInfo {
    email: string;
    name: string;
}

export interface DynamicTemplateData {
    supplierNumber: string;
    supplierName: string;
    subject: string;
    project: string;
    time: string;
    country: string;
    file: string;
    error: string;
}

export interface Supplier {
    id: number;
    supplier_number: string;
    name: string;
    street: string;
    zip: string;
    city: string;
    country: string;
    phone: string;
    fax: string;
    email: string;
    emailInvrpt: string;
    emailOstrpt: string;
    gln: string;
    url: string;
    mandator_id: string;
    main_purchaser: string;
    holiday_start_summer: Date;
    holiday_end_summer: Date;
    holiday_start_winter: Date;
    holiday_end_winter: Date;
    accept_online_shop: boolean;
    offboarding: Date;
}

export interface BucketFileInfo {
    filePath: string;
    bucketFilePath: string;
    bucket: string;
}

export interface TeamsAlertInfo {
    supplier: string;
    fileName: string;
    folderName: string;
}

export interface MailPubSubData {
    subject: string;
    supplierEmail: string;
    dynamicTemplateData: DynamicTemplateData;
    mailType: 'file' | 'content' | 'status';
}
