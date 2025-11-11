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
  cindex?: number;
  isActive?: boolean;
  country?: string;
  server?: string;
  status?: string;
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

