export interface DeviceType {
  _id: string;
  name: string;
  validityDays: number;
  isActive?: boolean;
  models?: string[];
  noSerial?: boolean;
  createdDate?: string;
  [key: string]: unknown;
}

