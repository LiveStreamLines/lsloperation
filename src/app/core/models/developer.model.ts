export interface DeveloperAddress {
  street?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  country?: string;
  [key: string]: unknown;
}

export interface DeveloperContactPerson {
  name?: string;
  position?: string;
  email?: string;
  phone?: string;
  [key: string]: unknown;
}

export interface DeveloperBankDetails {
  bankName?: string;
  accountNumber?: string;
  iban?: string;
  swiftCode?: string;
  [key: string]: unknown;
}

export interface DeveloperInternalAttachment {
  _id: string;
  name: string;
  originalName: string;
  size: number;
  type: string;
  url: string;
  uploadedAt?: string;
  uploadedBy?: string;
}

export interface Developer {
  _id: string;
  developerTag?: string;
  developerName: string;
  description?: string;
  internalDescription?: string;
  internalAttachments?: DeveloperInternalAttachment[];
  logo?: string | null;
  createdDate?: string;
  isActive?: boolean | string;
  email?: string;
  phone?: string;
  website?: string;
  vatNumber?: string;
  taxId?: string;
  businessLicense?: string;
  address?: DeveloperAddress;
  contactPerson?: DeveloperContactPerson;
  bankDetails?: DeveloperBankDetails;
  [key: string]: unknown;
}

