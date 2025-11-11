export interface Project {
  _id: string;
  developer: string | ProjectDeveloperReference;
  projectTag?: string;
  projectName: string;
  description?: string;
  logo?: string | null;
  createdDate?: string;
  status?: string;
  blocked?: boolean;
  isActive?: boolean | string;
  index?: string | number;
  [key: string]: unknown;
}

export interface ProjectDeveloperReference {
  _id?: string;
  developerTag?: string;
  developerName?: string;
  [key: string]: unknown;
}

