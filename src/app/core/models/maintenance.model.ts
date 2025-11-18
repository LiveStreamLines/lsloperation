export type MaintenanceStatus = 'pending' | 'in-progress' | 'completed' | 'cancelled';

export interface MaintenanceAttachment {
  _id: string;
  name: string;
  originalName: string;
  size: number;
  type: string;
  url: string;
  uploadedAt: string;
  uploadedBy?: string;
}

export interface Maintenance {
  _id: string;
  taskType: string;
  taskDescription: string;
  developerId?: string;
  projectId?: string;
  cameraId?: string;
  assignedUsers?: string[]; // Legacy field, kept for backward compatibility
  assignedUser?: string; // Single user - "Assigned to"
  assistants?: string[]; // Multiple users - "Assistant"
  status: MaintenanceStatus;
  dateOfRequest?: string;
  createdDate?: string;
  startTime?: string;
  completionTime?: string;
  userComment?: string;
  attachments?: MaintenanceAttachment[];
  isActive?: boolean;
  [key: string]: unknown;
}

export interface MaintenanceCreateRequest
  extends Partial<Omit<Maintenance, '_id' | 'assignedUsers' | 'assignedUser' | 'assistants'>> {
  assignedUsers?: string[]; // Legacy field
  assignedUser?: string; // Single user - "Assigned to"
  assistants?: string[]; // Multiple users - "Assistant"
}

export interface MaintenanceUpdateRequest
  extends Partial<Omit<Maintenance, '_id' | 'assignedUsers' | 'assignedUser' | 'assistants'>> {
  assignedUsers?: string[]; // Legacy field
  assignedUser?: string; // Single user - "Assigned to"
  assistants?: string[]; // Multiple users - "Assistant"
}

export const DEFAULT_MAINTENANCE_STATUS_ORDER: MaintenanceStatus[] = [
  'pending',
  'in-progress',
  'completed',
  'cancelled',
];

export const LEGACY_TASK_TYPES: readonly string[] = [
  'break down',
  'Maintenance',
  'Removal',
  'Installation',
  'Reinstallation',
];

