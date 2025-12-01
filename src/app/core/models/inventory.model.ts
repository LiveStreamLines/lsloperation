export interface InventoryDevice {
  type: string;
  serialNumber?: string;
  model?: string;
  [key: string]: unknown;
}

export interface InventoryAssignment {
  developer: string;
  project: string;
  camera: string;
  notes?: string;
  assignedDate?: string;
  removedDate?: string;
  removalReason?: string;
  [key: string]: unknown;
}

export interface InventoryUserAssignment {
  userId?: string;
  userName?: string;
  notes?: string;
  quantity?: number;
  assignedDate?: string;
  removedDate?: string;
  removalReason?: string;
  [key: string]: unknown;
}

export interface InventoryItem {
  _id: string;
  device?: InventoryDevice | null;
  status: string;
  validityDays?: number;
  isActive?: boolean;
  quantity?: number; // Total quantity (for no-serial devices)
  inStock?: number; // Available quantity in stock (for no-serial devices)
  createdDate?: string;
  // New structure for no-serial devices
  userAssignments?: Array<{
    userId: string;
    userName: string;
    qty: number;
    assignedDate?: string;
    [key: string]: unknown;
  }>;
  projectAssignments?: Array<{
    developer: string;
    project: string;
    camera: string;
    qty: number;
    notes?: string;
    assignedDate?: string;
    [key: string]: unknown;
  }>;
  // Legacy structure for serialized devices (backward compatibility)
  assignmentHistory?: InventoryAssignment[];
  currentAssignment?: InventoryAssignment | null;
  userAssignmentHistory?: InventoryUserAssignment[];
  currentUserAssignment?: InventoryUserAssignment | null;
  assignedCameraId?: string;
  assignedCameraName?: string;
  [key: string]: unknown;
}

export type InventoryAssignmentPayload = Omit<
  InventoryAssignment,
  'assignedDate' | 'removedDate' | 'removalReason'
>;

export type InventoryUserAssignmentPayload = Omit<
  InventoryUserAssignment,
  'assignedDate' | 'removedDate' | 'removalReason'
>;

export interface InventoryUnassignRequest {
  reason: string;
}

