import { UserRole } from './user-account.model';

export interface User {
  _id: string;
  name: string;
  email: string;
  phone?: string;
  role: UserRole | string;
  country?: 'UAE' | 'Saudi Arabia';
  image?: string; // User profile image/avatar URL (legacy/alias)
  logo?: string; // User profile image/avatar path (backend field: logos/user/filename)
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

