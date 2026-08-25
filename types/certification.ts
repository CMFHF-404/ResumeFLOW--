export interface Certification {
  id: string;
  user_id: string;
  name: string;
  issuer?: string;
  issue_date?: string | null;
  expiry_date?: string | null;
  credential_id?: string;
  credential_url?: string;
  description?: string;
  created_at: string;
  updated_at: string;
}

export interface CertificationCreatePayload {
  name: string;
  issuer?: string;
  issue_date?: string | null;
  expiry_date?: string | null;
  credential_id?: string;
  credential_url?: string;
  description?: string;
}

export interface CertificationUpdatePayload {
  name?: string;
  issuer?: string;
  issue_date?: string | null;
  expiry_date?: string | null;
  credential_id?: string;
  credential_url?: string;
  description?: string;
}
