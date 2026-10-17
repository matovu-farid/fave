-- Receipt is not erasure. Keep the shared identity and its existing obligations.
CREATE TABLE account_deletion_requests (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL UNIQUE REFERENCES user(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status = 'requested'),
  requested_at INTEGER NOT NULL CHECK (requested_at > 0)
);
CREATE INDEX account_deletion_requests_received ON account_deletion_requests(requested_at, id);
CREATE TRIGGER account_deletion_request_immutable BEFORE UPDATE ON account_deletion_requests
BEGIN SELECT RAISE(ABORT, 'account deletion request is immutable'); END;

-- A committed receipt wins over a later new-work write, even if its eligibility
-- read happened earlier. These guards never cancel or remove an existing booking.
CREATE TRIGGER trip_estimates_account_new_work
BEFORE INSERT ON trip_estimates
WHEN (EXISTS (SELECT 1 FROM account_deletion_requests WHERE user_id = NEW.client_user_id)
 OR EXISTS (SELECT 1 FROM vehicles v JOIN driver_applications d ON d.id = v.driver_application_id
   JOIN account_deletion_requests r ON r.user_id = d.user_id WHERE v.id = NEW.vehicle_id)
 OR EXISTS (SELECT 1 FROM driver_applications d JOIN account_deletion_requests r ON r.user_id = d.user_id
   WHERE d.id = NEW.driver_application_id))
BEGIN SELECT RAISE(ABORT, 'account deletion blocks new work'); END;

CREATE TRIGGER availability_requests_account_new_work
BEFORE INSERT ON availability_requests
WHEN (EXISTS (SELECT 1 FROM account_deletion_requests WHERE user_id = NEW.client_user_id)
 OR EXISTS (SELECT 1 FROM vehicles v JOIN driver_applications d ON d.id = v.driver_application_id
   JOIN account_deletion_requests r ON r.user_id = d.user_id WHERE v.id = NEW.vehicle_id)
 OR EXISTS (SELECT 1 FROM driver_applications d JOIN account_deletion_requests r ON r.user_id = d.user_id
   WHERE d.id = NEW.driver_application_id))
BEGIN SELECT RAISE(ABORT, 'account deletion blocks new work'); END;

CREATE TRIGGER trip_quotes_account_new_work
BEFORE INSERT ON trip_quotes
WHEN (EXISTS (SELECT 1 FROM account_deletion_requests WHERE user_id = NEW.client_user_id)
 OR EXISTS (SELECT 1 FROM vehicles v JOIN driver_applications d ON d.id = v.driver_application_id
   JOIN account_deletion_requests r ON r.user_id = d.user_id WHERE v.id = NEW.vehicle_id))
BEGIN SELECT RAISE(ABORT, 'account deletion blocks new work'); END;

CREATE TRIGGER bookings_account_new_work
BEFORE INSERT ON bookings
WHEN (EXISTS (SELECT 1 FROM account_deletion_requests WHERE user_id = NEW.client_user_id)
 OR EXISTS (SELECT 1 FROM vehicles v JOIN driver_applications d ON d.id = v.driver_application_id
   JOIN account_deletion_requests r ON r.user_id = d.user_id WHERE v.id = NEW.vehicle_id))
BEGIN SELECT RAISE(ABORT, 'account deletion blocks new work'); END;

CREATE TRIGGER driver_trip_offers_account_new_work
BEFORE INSERT ON driver_trip_offers
WHEN (EXISTS (SELECT 1 FROM account_deletion_requests WHERE user_id = NEW.client_user_id)
 OR EXISTS (SELECT 1 FROM vehicles v JOIN driver_applications d ON d.id = v.driver_application_id
   JOIN account_deletion_requests r ON r.user_id = d.user_id WHERE v.id = NEW.vehicle_id)
 OR EXISTS (SELECT 1 FROM driver_applications d JOIN account_deletion_requests r ON r.user_id = d.user_id
   WHERE d.id = NEW.driver_application_id))
BEGIN SELECT RAISE(ABORT, 'account deletion blocks new work'); END;

CREATE TRIGGER availability_confirmation_account_new_work
BEFORE UPDATE OF status ON availability_requests
WHEN (NEW.status = 'confirmed' AND OLD.status != 'confirmed') AND (EXISTS (SELECT 1 FROM account_deletion_requests WHERE user_id = NEW.client_user_id)
 OR EXISTS (SELECT 1 FROM vehicles v JOIN driver_applications d ON d.id = v.driver_application_id
   JOIN account_deletion_requests r ON r.user_id = d.user_id WHERE v.id = NEW.vehicle_id)
 OR EXISTS (SELECT 1 FROM driver_applications d JOIN account_deletion_requests r ON r.user_id = d.user_id
   WHERE d.id = NEW.driver_application_id))
BEGIN SELECT RAISE(ABORT, 'account deletion blocks new work'); END;

CREATE TRIGGER driver_offer_acceptance_account_new_work
BEFORE UPDATE OF status ON driver_trip_offers
WHEN (NEW.status IN ('quoting', 'quoted') AND NEW.status != OLD.status) AND (EXISTS (SELECT 1 FROM account_deletion_requests WHERE user_id = NEW.client_user_id)
 OR EXISTS (SELECT 1 FROM vehicles v JOIN driver_applications d ON d.id = v.driver_application_id
   JOIN account_deletion_requests r ON r.user_id = d.user_id WHERE v.id = NEW.vehicle_id)
 OR EXISTS (SELECT 1 FROM driver_applications d JOIN account_deletion_requests r ON r.user_id = d.user_id
   WHERE d.id = NEW.driver_application_id))
BEGIN SELECT RAISE(ABORT, 'account deletion blocks new work'); END;

CREATE TRIGGER booking_assignment_account_new_work
BEFORE UPDATE OF vehicle_id ON bookings
WHEN (NEW.vehicle_id IS NOT OLD.vehicle_id) AND (EXISTS (SELECT 1 FROM vehicles v JOIN driver_applications d ON d.id = v.driver_application_id
 JOIN account_deletion_requests r ON r.user_id = d.user_id WHERE v.id = NEW.vehicle_id))
BEGIN SELECT RAISE(ABORT, 'account deletion blocks new work'); END;
