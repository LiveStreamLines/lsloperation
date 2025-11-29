export interface Contact {
  _id: string;
  name: string;
  phone: string;
  email: string;
  company: string;
  designation: string;
  notes: string;
  developerId?: string | null;
  projectId?: string | null;
  cameraId?: string | null;
  isActive?: boolean;
  createdDate?: string;
  [key: string]: unknown;
}

