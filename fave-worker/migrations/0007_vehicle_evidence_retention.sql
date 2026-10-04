ALTER TABLE vehicle_media ADD COLUMN retention_policy_id TEXT REFERENCES retention_policies(id);
ALTER TABLE vehicle_media ADD COLUMN retention_expires_at INTEGER;

UPDATE vehicle_media
   SET retention_policy_id = (
         SELECT id FROM retention_policies
          WHERE record_type = 'vehicle_evidence' AND active = 1 AND approved_at IS NOT NULL
          ORDER BY approved_at DESC LIMIT 1
       ),
       retention_expires_at = created_at + (
         SELECT retention_days * 86400000 FROM retention_policies
          WHERE record_type = 'vehicle_evidence' AND active = 1 AND approved_at IS NOT NULL
          ORDER BY approved_at DESC LIMIT 1
       )
 WHERE media_kind != 'client_photo'
   AND EXISTS (
         SELECT 1 FROM retention_policies
          WHERE record_type = 'vehicle_evidence' AND active = 1 AND approved_at IS NOT NULL
       );

CREATE INDEX IF NOT EXISTS vehicle_media_retention_expiry
  ON vehicle_media(retention_expires_at)
  WHERE retention_expires_at IS NOT NULL;
