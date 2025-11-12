export type MemoryStatus = 'active' | 'removed' | 'archived';

export interface Memory {
  _id: string;
  developer: string;
  project: string;
  camera: string;
  memoryUsed?: string;
  memoryAvailable?: string;
  status?: string;
  isActive?: boolean;
  createdDate?: string;
  endDate?: string;
  dateOfRemoval?: string;
  dateOfReceive?: string;
  RemovalUser?: string;
  RecieveUser?: string;
  numberofpics?: number;
  numberOfPics?: number;
  shuttercount?: number;
  [key: string]: unknown;
}

export interface MemoryCreateRequest {
  developer: string;
  project: string;
  camera: string;
  numberofpics?: number;
  numberOfPics?: number;
  memoryUsed?: string;
  memoryAvailable?: string;
  status?: MemoryStatus;
  [key: string]: unknown;
}

export interface MemoryUpdateRequest extends Partial<MemoryCreateRequest> {
  dateOfRemoval?: string;
  dateOfReceive?: string;
  RemovalUser?: string;
  RecieveUser?: string;
}

export interface MemoryFindRequest {
  developer: string;
  project: string;
  camera: string;
}

export interface MemoryFindResponse {
  result: string;
}

