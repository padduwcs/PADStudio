export const minimumNodeVersion: number[];

export interface DoctorItem {
  name: string;
  required: boolean;
  state: 'available' | 'unavailable' | 'configured' | 'not configured';
  detail: string;
}

export function parseVersion(value: string): number[] | null;
export function versionAtLeast(actual: number[] | null, required?: number[]): boolean;
export function createDoctorReport(options?: {
  environment?: NodeJS.ProcessEnv;
  nodeVersion?: string;
  repositoryRoot?: string;
  probe?: (command: string) => {available: boolean; detail?: string};
  isAccessible?: (target: string) => boolean;
  storedCredentialConfigured?: boolean;
}): {items: DoctorItem[]; requiredUnavailable: DoctorItem[]};
