export type TaskStatus = 'open' | 'closed';

export type TaskType =
  | 'purchase_request'
  | 'site_visit_request'
  | 'media_image_filtration'
  | 'other';

export interface TaskAttachment {
  _id: string;
  name: string;
  originalName: string;
  size: number;
  type: string;
  url: string;
  uploadedAt: string;
  uploadedBy: string;
  context: 'initial' | 'note';
}

export interface TaskNote {
  _id: string;
  content: string;
  user: string;
  userName: string;
  attachments: TaskAttachment[];
  createdAt: string;
}

export interface Task {
  _id: string;
  title: string;
  description: string;
  type: TaskType;
  assignee: string;
  assigneeName: string;
  assigned: string;
  assignedName: string;
  approver?: string | null;
  approverName?: string | null;
  status: TaskStatus;
  attachments: TaskAttachment[];
  notes: TaskNote[];
  createdDate: string;
  updatedDate: string;
  closedBy?: string;
  closedAt?: string;
  [key: string]: unknown;
}

