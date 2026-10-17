export function currentDriverEvidencePredicate(applicationAlias: string, time = '?'): string {
  return `EXISTS (
    SELECT 1 FROM driver_verification_requirements AS current_requirement
     WHERE current_requirement.active = 1 AND current_requirement.required = 1
       AND current_requirement.approved_at IS NOT NULL
  )
  AND NOT EXISTS (
    SELECT 1 FROM driver_verification_requirements AS requirement
     WHERE requirement.active = 1 AND requirement.required = 1
       AND requirement.approved_at IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM driver_application_documents AS document
          WHERE document.application_id = ${applicationAlias}.id
            AND document.submission_version = ${applicationAlias}.submission_version
            AND document.document_type = requirement.document_type
            AND document.requirement_version = requirement.version
            AND document.review_status = 'approved'
            AND document.retention_expires_at IS NOT NULL
            AND document.retention_expires_at > ${time}
       )
  )
  AND (
    SELECT COUNT(DISTINCT document.document_type)
      FROM driver_application_documents AS document
     WHERE document.application_id = ${applicationAlias}.id
       AND document.submission_version = ${applicationAlias}.submission_version
       AND document.review_status = 'approved'
       AND document.retention_expires_at IS NOT NULL
       AND document.retention_expires_at > ${time}
       AND document.document_type IN ('national_id_front', 'national_id_back', 'passport_photo')
  ) = 3`
}

export function driverApprovalRequirementsPredicate(alias: string, time = '?'): string {
  return `NOT EXISTS (SELECT 1 FROM account_deletion_requests closing_account WHERE closing_account.user_id = ${alias}.user_id)
       AND ${alias}.citizenship_attested_at IS NOT NULL
       AND ${alias}.retention_expires_at IS NOT NULL
       AND ${alias}.retention_expires_at > ${time}
       AND EXISTS (
         SELECT 1 FROM retention_policies AS retention
          WHERE retention.record_type = 'driver_application'
            AND retention.active = 1 AND retention.approved_at IS NOT NULL
       )
       AND ${currentDriverEvidencePredicate(alias, time)}
       AND (
         SELECT COUNT(DISTINCT acceptance.document_id)
           FROM policy_acceptances AS acceptance
           JOIN policy_documents AS policy ON policy.id = acceptance.document_id
          WHERE acceptance.user_id = ${alias}.user_id
            AND acceptance.onboarding_context = 'driver_onboarding'
            AND policy.document_type IN ('driver_terms', 'driver_privacy')
            AND policy.language = 'en' AND policy.status = 'approved'
            AND policy.effective_at IS NOT NULL AND policy.effective_at <= ${time}
            AND NOT EXISTS (
              SELECT 1 FROM policy_documents AS newer
               WHERE newer.document_type = policy.document_type
                 AND newer.language = policy.language
                 AND newer.status = 'approved'
                 AND newer.effective_at IS NOT NULL AND newer.effective_at <= ${time}
                 AND (newer.effective_at > policy.effective_at OR
                      (newer.effective_at = policy.effective_at AND newer.id > policy.id))
            )
       ) = 2`
}

export function approvedDriverEvidencePredicate(driverApplicationId: string): string {
  return `EXISTS (SELECT 1 FROM driver_applications AS eligible_driver
    WHERE eligible_driver.id = ${driverApplicationId} AND eligible_driver.status = 'approved'
      AND ${driverApprovalRequirementsPredicate('eligible_driver')})`
}

