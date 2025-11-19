export interface Project {
  _id: string;
  developer: string | ProjectDeveloperReference;
  projectTag?: string;
  projectName: string;
  description?: string;
  logo?: string | null;
  createdDate?: string;
  status?: string;
  blocked?: boolean;
  isActive?: boolean | string;
  index?: string | number;
  attachments?: ProjectAttachment[];
  internalDescription?: string;
  internalAttachments?: ProjectInternalAttachment[];
  [key: string]: unknown;
}

export interface ProjectDeveloperReference {
  _id?: string;
  developerTag?: string;
  developerName?: string;
  [key: string]: unknown;
}

export interface ProjectAttachment {
  _id?: string;
  name?: string;
  originalName?: string;
  size?: number;
  type?: string;
  url?: string;
  uploadedAt?: string;
  uploadedBy?: string;
  [key: string]: unknown;
}

export interface ProjectInternalAttachment {
  _id: string;
  name: string;
  originalName?: string;
  size: number;
  type?: string;
  url: string;
  uploadedAt?: string;
  uploadedBy?: string;
  [key: string]: unknown;
}

