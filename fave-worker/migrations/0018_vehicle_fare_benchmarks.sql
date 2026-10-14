ALTER TABLE vehicles ADD COLUMN benchmark_amount_ugx INTEGER
  CHECK (benchmark_amount_ugx IS NULL OR benchmark_amount_ugx BETWEEN 1 AND 1000000000);

ALTER TABLE vehicles ADD COLUMN benchmark_basis_json TEXT
  CHECK (benchmark_basis_json IS NULL OR json_valid(benchmark_basis_json));

ALTER TABLE vehicles ADD COLUMN benchmark_derivation_version INTEGER
  CHECK (benchmark_derivation_version IS NULL OR benchmark_derivation_version = 1);
