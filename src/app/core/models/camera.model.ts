export interface Camera {
  _id: string;
  camera: string;
  developer: string | CameraDeveloperReference;
  project: string | CameraProjectReference;
  cameraDescription?: string;
  lat?: number | null;
  lng?: number | null;
  serverFolder?: string;
  createdDate?: string;
  installedDate?: string;
  cindex?: number;
  isActive?: boolean;
  country?: string;
  server?: string;
  status?: string;
  blocked?: boolean;
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

