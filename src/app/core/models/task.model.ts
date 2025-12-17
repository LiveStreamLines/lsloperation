export type TaskStatus = 'open' | 'closed';

export type TaskType = 'operation' | 'finance' | 'media' | 'other';

export const TASK_TYPE_OPTIONS: Array<{ value: TaskType; label: string }> = [
  { value: 'operation', label: 'Operation' },
  { value: 'finance', label: 'Finance' },
  { value: 'media', label: 'Media' },
  { value: 'other', label: 'Other' },
];

export function getTaskTypeLabel(type: string | undefined | null): string {
  const normalized = (type ?? '').trim().toLowerCase();
  return TASK_TYPE_OPTIONS.find((t) => t.value === (normalized as TaskType))?.label ?? 'Other';
}

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
  concernedUsers: string[];
  concernedNames: string[];
  status: TaskStatus;
  attachments: TaskAttachment[];
  notes: TaskNote[];
  createdDate: string;
  updatedDate: string;
  closedBy?: string;
  closedAt?: string;
  [key: string]: unknown;
}

