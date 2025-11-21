export interface CameraInternalAttachment {
  _id: string;
  name: string;
  originalName?: string;
  size: number;
  type: string;
  url: string;
  uploadedAt?: string;
  uploadedBy?: string;
  [key: string]: unknown;
}

export interface Camera {
  _id: string;
  camera: string;
  developer: string | CameraDeveloperReference;
  project: string | CameraProjectReference;
  cameraDescription?: string;
  internalDescription?: string;
  internalAttachments?: CameraInternalAttachment[];
  lat?: number | null;
  lng?: number | null;
  serverFolder?: string;
  createdDate?: string;
  installedDate?: string;
  maintenanceCycleStartDate?: string;
  cindex?: number;
  isActive?: boolean;
  country?: string;
  server?: string;
  status?: string;
  blocked?: boolean;
  maintenanceStatus?: {
    photoDirty?: boolean;
    lowImages?: boolean;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface CameraDeveloperReference {
  _id?: string;
  developerName?: string;
  developerTag?: string;
  [key: string]: unknown;
}

export interface CameraProjectReference {
  _id?: string;
  projectName?: string;
  projectTag?: string;
  [key: string]: unknown;
}

export interface CameraLastPicture {
  FullName?: string;
  developerId?: string;
  projectId?: string;
  developerTag?: string;
  projectTag?: string;
  developer?: string;
  project?: string;
  cameraName?: string;
  serverfolder?: string;
  lastPhoto?: string;
  lastPhotoTime?: string;
  error?: string;
  [key: string]: unknown;
}

export interface CameraHistoryResponse {
  firstPhoto?: string;
  lastPhoto?: string;
  date1Photos?: string[];
  date2Photos?: string[];
  path?: string;
  error?: string;
  [key: string]: unknown;
}

export interface CameraHistoryPreviewResponse {
  weeklyImages?: string[];
  path?: string;
  error?: string;
  [key: string]: unknown;
}

export interface CameraHistoryVideoResponse {
  message?: string;
  videoPath?: string;
  error?: string;
  [key: string]: unknown;
}

export interface CameraHealthResponse {
  developerId: string;
  projectId: string;
  cameraId: string;
  hasDeviceExpired?: boolean;
  firstDay?: {
    date: string;
    count: number;
  };
  secondDay?: {
    date: string;
    count: number;
  };
  thirdDay?: {
    date: string;
    count: number;
  };
  totalImages: number;
  hasMemoryAssigned?: boolean;
  memoryAvailable?: string | null;
  hasWrongTime?: boolean;
  hasShutterExpiry?: boolean;
  shutterCount?: number | null;
  error?: string;
  [key: string]: unknown;
}

export interface CameraStatusHistory {
  _id: string;
  cameraId: string;
  cameraName?: string;
  developerId?: string;
  projectId?: string;
  statusType: 'photoDirty' | 'betterView' | 'lowImages' | 'wrongTime' | 'shutterExpiry' | 'deviceExpiry';
  action: 'on' | 'off';
  isActive: boolean;
  performedBy: string;
  performedByEmail?: string | null;
  performedAt: string;
}

