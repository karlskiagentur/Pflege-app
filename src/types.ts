
export enum View {
  DASHBOARD = 'dashboard',
  PLANNER = 'planner',
  DIARY = 'diary',
  SERVICE = 'service'
}

export interface VitalSign {
  date: string;
  bloodPressure: string;
  pulse: number;
  bloodSugar?: number;
}

export interface CareReport {
  id: string;
  date: string;
  author: string;
  content: string;
}

export interface Appointment {
  id: string;
  time: string;
  date: string;
  task: string;
  caregiver: {
    name: string;
    photo: string;
  };
}

export interface Contact {
  name: string;
  role: string;
  phone: string;
}

export interface PatientData {
  name: string;
  birthDate: string;
  careLevel: number;
  address: string;
  insurance: string;
  contacts: Contact[];
}
