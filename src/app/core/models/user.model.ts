import { UserRole } from './user-account.model';

export interface User {
  _id: string;
  name: string;
  email: string;
  phone?: string;
  role: UserRole | string;
  accessibleDevelopers: string[];
  accessibleProjects: string[];
  accessibleCameras: string[];
  accessibleServices?: string[];
  status?: string;
  isActive?: boolean;
  createdDate?: string;
  LastLoginTime?: string;
  resetPasswordToken?: string | null;
  resetPasswordExpires?: string | number | null;
  [key: string]: unknown;
}

