export type MaintenanceStatus = 'pending' | 'in-progress' | 'completed' | 'cancelled';

export interface Maintenance {
  _id: string;
  taskType: string;
  taskDescription: string;
  developerId?: string;
  projectId?: string;
  cameraId?: string;
  assignedUsers?: string[];
  assignedUser?: string;
  status: MaintenanceStatus;
  dateOfRequest?: string;
  createdDate?: string;
  startTime?: string;
  completionTime?: string;
  userComment?: string;
  isActive?: boolean;
  [key: string]: unknown;
}

export interface MaintenanceCreateRequest
  extends Partial<Omit<Maintenance, '_id' | 'assignedUsers' | 'assignedUser'>> {
  assignedUsers?: string[];
  assignedUser?: string;
}

export interface MaintenanceUpdateRequest
  extends Partial<Omit<Maintenance, '_id' | 'assignedUsers' | 'assignedUser'>> {
  assignedUsers?: string[];
  assignedUser?: string;
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

