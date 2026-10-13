ALTER TABLE driver_applications
  ADD COLUMN lodging_rate_ugx INTEGER CHECK (
    lodging_rate_ugx IS NULL OR lodging_rate_ugx BETWEEN 1 AND 1000000000
  );
