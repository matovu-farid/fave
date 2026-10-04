import { useCallback, useEffect, useState } from 'react'
import { Image, ScrollView, StyleSheet, View } from 'react-native'
import * as ImagePicker from 'expo-image-picker'
import * as DocumentPicker from 'expo-document-picker'

import { ActionButton, Card, CheckRow, Field, Message, SectionTitle, formStyles } from '@/components/marketplace-ui'
import { ThemedText } from '@/components/themed-text'
import { ThemedView } from '@/components/themed-view'
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme'
import { acceptDriverPolicies, DriverApplication, DriverPrerequisites, getDriverApplication, getDriverPrerequisites, getMyVehicles, getVehicleAvailability, getVehicleRequirements, submitDriverApplication, submitVehicle, submitVehicleCorrections, updateVehicle, markUnavailable, removeUnavailable, Vehicle, VehicleAvailability, VehicleRequirements } from '@/lib/marketplace'

type Picked = { uri: string; fileName: string; mimeType: string; file?: Blob }
const maxEvidenceBytes = 8 * 1024 * 1024
const acceptedEvidenceTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
const acceptedImageTypes = new Set(['image/jpeg', 'image/png', 'image/webp'])
const builtInIdentityTypes = new Set(['national_id_front', 'national_id_back', 'passport_photo'])

async function imageFormFile(asset: ImagePicker.ImagePickerAsset): Promise<Picked> {
  let file: Blob
  if (asset.file) {
    file = asset.file
  } else {
    const response = await fetch(asset.uri)
    if (!response.ok) throw new Error('Could not read the selected photo. Choose it again.')
    file = await response.blob()
  }
  const mimeType = file.type || asset.mimeType || ''
  if (!acceptedImageTypes.has(mimeType)) {
    throw new Error('This photo format is not supported. Choose a JPEG, PNG, or WebP photo.')
  }
  if (file.size < 1 || file.size > maxEvidenceBytes) {
    throw new Error('Photos must be smaller than 8 MB.')
  }
  const normalizedFile = file.type === mimeType ? file : new Blob([file], { type: mimeType })
  const extension = mimeType === 'image/jpeg' ? 'jpg' : mimeType.slice('image/'.length)
  return { uri: asset.uri, fileName: `image.${extension}`, mimeType, file: normalizedFile }
}

async function chooseImages(multiple = false): Promise<Picked[]> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'], allowsEditing: false, allowsMultipleSelection: multiple, selectionLimit: multiple ? 8 : 1, quality: 0.85,
    preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
  })
  if (result.canceled) return []
  return Promise.all(result.assets.map(imageFormFile))
}

async function chooseEvidenceFile(): Promise<Picked | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
    copyToCacheDirectory: true,
    base64: false,
  })
  if (result.canceled) return null
  const asset = result.assets[0]
  if (!asset) return null
  const pickedFile: Blob = asset.file ? asset.file : await fetch(asset.uri).then((response) => response.blob())
  const extensionMimeTypes: Record<string, string> = {
    pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
  }
  const extension = asset.name.split('.').pop()?.toLowerCase() ?? ''
  const mimeType = asset.mimeType || pickedFile.type || extensionMimeTypes[extension] || ''
  const file = pickedFile.type === mimeType ? pickedFile : new Blob([pickedFile], { type: mimeType })
  if (!acceptedEvidenceTypes.has(mimeType)) {
    throw new Error('Choose a JPEG, PNG, WebP, or PDF file.')
  }
  if (file.size < 1 || file.size > maxEvidenceBytes) {
    throw new Error('Evidence files must be smaller than 8 MB.')
  }
  return { uri: asset.uri, fileName: asset.name, mimeType, file }
}

function addFile(form: FormData, key: string, file: Picked) {
  if (file.file) form.append(key, file.file, file.fileName)
}

export default function DriverScreen() {
  const [prerequisites, setPrerequisites] = useState<DriverPrerequisites | null>(null)
  const [application, setApplication] = useState<DriverApplication | null>(null)
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [accepted, setAccepted] = useState(false)
  const [legalName, setLegalName] = useState('')
  const [phoneNumber, setPhoneNumber] = useState('')
  const [nationalId, setNationalId] = useState('')
  const [citizenshipConfirmed, setCitizenshipConfirmed] = useState(false)
  const [files, setFiles] = useState<Record<string, Picked>>({})

  const refresh = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [requirements, result, mine] = await Promise.all([getDriverPrerequisites(), getDriverApplication(), getMyVehicles()])
      setPrerequisites(requirements)
      setApplication(result.application)
      setVehicles(mine.vehicles)
      if (result.application?.needsEvidenceRefresh || result.application?.needsPolicyAcceptance) setAccepted(false)
      setLegalName(result.application?.legalName ?? '')
      setPhoneNumber(requirements.phone.number ?? result.application?.phoneNumber ?? '')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load driver requirements.')
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { void Promise.resolve().then(refresh) }, [refresh])

  const pick = async (key: string, allowPdf = false) => {
    try {
      const file = allowPdf ? await chooseEvidenceFile() : (await chooseImages())[0]
      if (file) setFiles((current) => ({ ...current, [key]: file }))
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not open your photo library. Check photo access and try again.') }
  }

  const submit = async () => {
    if (!prerequisites) return
    setBusy(true); setError('')
    try {
      const currentDocuments = prerequisites.documents.map((document) => document.id)
      await acceptDriverPolicies(currentDocuments)
      const form = new FormData()
      form.append('legalName', legalName)
      form.append('phoneNumber', phoneNumber)
      form.append('nationalIdNumber', nationalId)
      form.append('citizenshipConfirmation', citizenshipConfirmed ? 'ugandan_citizen' : '')
      for (const [key, file] of Object.entries(files)) addFile(form, `evidence:${key}`, file)
      await submitDriverApplication(form)
      setNationalId(''); setFiles({}); setCitizenshipConfirmed(false)
      await refresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not submit your application.') }
    finally { setBusy(false) }
  }

  const acceptUpdatedPolicies = async () => {
    if (!prerequisites) return
    setBusy(true); setError('')
    try {
      await acceptDriverPolicies(prerequisites.documents.map((document) => document.id))
      setAccepted(false)
      await refresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not accept the current driver terms.') }
    finally { setBusy(false) }
  }

  const canResubmit = !application || ['draft', 'needs_correction', 'rejected'].includes(application.status) ||
    (application.status === 'pending_verification' && application.needsCitizenshipConfirmation === true) ||
    (application.status === 'approved' && application.needsEvidenceRefresh === true)
  const phoneMatchesVerification = Boolean(
    prerequisites?.phone.verified && prerequisites.phone.number === phoneNumber.trim(),
  )
  const hasAllFiles = Boolean(files.national_id_front && files.national_id_back && files.passport_photo && prerequisites?.verificationChecklist.every((item) => files[item.document_type]))

  if (loading) return <ThemedView style={styles.loading}><ThemedText>Loading driver requirements…</ThemedText></ThemedView>

  return <ThemedView style={styles.page}>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <SectionTitle title="Drive with Fave" detail="This release accepts applications from Ugandan citizen drivers with a National ID. Foreign nationals and refugees cannot apply as drivers. Your identity documents are private, reviewed by designated staff, and access is audited." />
      {error ? <Message error>{error}</Message> : null}
      {application ? <Card>
        <ThemedText type="subtitle">Application · {application.status.replaceAll('_', ' ')}</ThemedText>
        <ThemedText>{application.nextAction}</ThemedText>
        {application.retentionExpiresAt ? <ThemedText type="small">Private evidence deletion deadline · {new Date(application.retentionExpiresAt).toLocaleString()}{application.retentionPolicyVersion ? ` · policy v${application.retentionPolicyVersion}` : ''}. Cleanup runs hourly.</ThemedText> : null}
        {application.applicantMessage ? <Message>{application.applicantMessage}</Message> : null}
        {application.documents.map((doc) => <ThemedText key={doc.id} type="small">{doc.type.replaceAll('_', ' ')}{doc.requirementVersion ? ` · v${doc.requirementVersion}` : ''} · {doc.status}</ThemedText>)}
      </Card> : null}
      {application?.status === 'approved' && application.needsPolicyAcceptance && !application.needsEvidenceRefresh && prerequisites ? <Card>
        <ThemedText type="subtitle">Review updated driver terms</ThemedText>
        {prerequisites.documents.map((document) => <View key={document.id} style={styles.document}>
          <ThemedText type="smallBold">{document.type.replaceAll('_', ' ')} · v{document.version}</ThemedText>
          <ThemedText>{document.body}</ThemedText>
        </View>)}
        {prerequisites.documents.length === 2 ? <CheckRow title="I accept the current driver terms and privacy notice" checked={accepted} onPress={() => setAccepted(!accepted)} disabled={busy} /> : null}
        {prerequisites.documents.length !== 2 ? <Message>Current approved driver terms and privacy notice are not available yet.</Message> : null}
        <ActionButton title="Accept updated driver terms" onPress={() => void acceptUpdatedPolicies()} disabled={!accepted || prerequisites.documents.length !== 2} busy={busy} />
      </Card> : null}
      {!prerequisites?.phone.verified ? <Card><ThemedText type="subtitle">Verify your phone first</ThemedText><Message>Your phone number must be verified before we can accept a driver application. Phone verification is not configured yet.</Message></Card> : null}
      {!prerequisites?.retentionPolicy.active || !prerequisites.readyToApply ? <Card><ThemedText type="subtitle">Application requirements</ThemedText><Message>Current approved driver terms, privacy notice, evidence checklist, phone verification, and document retention rules are all required before submission.</Message></Card> : null}
      {canResubmit && prerequisites ? <>
        {application?.status === 'approved' && application.needsEvidenceRefresh ? <Message>Your current verification evidence must be refreshed. Submitting it returns the application to staff review, and your vehicles stay hidden until approval.</Message> : null}
        <Card>
          <ThemedText type="subtitle">Before you apply</ThemedText>
          {prerequisites.documents.map((document) => <View key={document.id} style={styles.document}>
            <ThemedText type="smallBold">{document.type.replaceAll('_', ' ')} · v{document.version}</ThemedText>
            <ThemedText>{document.body}</ThemedText>
          </View>)}
          {prerequisites.documents.length > 0 ? <CheckRow title="I agree to the current driver terms and privacy notice" checked={accepted} onPress={() => setAccepted(!accepted)} /> : null}
        </Card>
        <Card>
          <ThemedText type="subtitle">Your details</ThemedText>
          <Field label="Legal name" value={legalName} onChangeText={setLegalName} placeholder="As shown on your identity document" />
          <Field label="Verified phone number" value={phoneNumber} onChangeText={setPhoneNumber} placeholder="+256…" keyboardType="phone-pad" />
          {prerequisites.phone.verified && !phoneMatchesVerification ? <Message>The number must match the phone verified for this account. Verify a new number before applying with it.</Message> : null}
          <CheckRow title="I am a Ugandan citizen and have a National ID" detail="Fave is not accepting foreign-national or refugee driver applications in this release." checked={citizenshipConfirmed} onPress={() => setCitizenshipConfirmed(!citizenshipConfirmed)} disabled={busy} />
          <Field label="National ID number" value={nationalId} onChangeText={setNationalId} placeholder="Enter the number on your ID" autoCapitalize="characters" />
          <ThemedText type="smallBold">National ID images</ThemedText>
          <View style={formStyles.row}>
            <PickButton label="Front" file={files.national_id_front} onPress={() => void pick('national_id_front')} />
            <PickButton label="Back" file={files.national_id_back} onPress={() => void pick('national_id_back')} />
          </View>
          <PickButton label="Passport-style photo" file={files.passport_photo} onPress={() => void pick('passport_photo')} />
          {prerequisites.verificationChecklist.filter((item) => !builtInIdentityTypes.has(item.document_type)).map((item) => <PickButton key={item.document_type} label={item.document_type.replaceAll('_', ' ')} file={files[item.document_type]} onPress={() => void pick(item.document_type, true)} />)}
          <Message>Your National ID is the only identity document requested. The passport-style photo is a separate driver photo, not another identity document. Keep both private; only designated staff can review them. Accepted formats: JPEG, PNG, or WebP for identity images; checklist evidence accepts those formats or PDF. Each file can be up to 8 MB.</Message>
          {prerequisites.retentionPolicy.active ? <Message>Your application evidence will be deleted {prerequisites.retentionPolicy.retentionDays} days after submission under approved retention policy{prerequisites.retentionPolicy.version ? ` v${prerequisites.retentionPolicy.version}` : ''}. Cleanup runs hourly.</Message> : null}
          <ActionButton title={application ? 'Resubmit application' : 'Submit application'} onPress={() => void submit()} disabled={!accepted || !prerequisites.readyToApply || !phoneMatchesVerification || !citizenshipConfirmed || !hasAllFiles || !legalName.trim() || !nationalId.trim()} busy={busy} />
        </Card>
      </> : null}
      {application?.status === 'approved' && !application.needsEvidenceRefresh && !application.needsPolicyAcceptance ? <VehicleSection vehicles={vehicles} refresh={refresh} /> : null}
      {application && application.status !== 'approved' ? <ActionButton title="Refresh status" onPress={() => void refresh()} /> : null}
    </ScrollView>
  </ThemedView>
}

function PickButton({ label, file, onPress }: { label: string; file?: Picked; onPress: () => void }) {
  return <View style={styles.pickWrap}>
    <ActionButton title={file ? `Replace ${label}` : `Add ${label}`} onPress={onPress} />
    {file ? <>
      {file.mimeType.startsWith('image/') ? <Image source={{ uri: file.uri }} style={styles.preview} /> : <ThemedText type="smallBold">PDF selected</ThemedText>}
      <ThemedText type="small">{file.fileName}</ThemedText>
    </> : null}
  </View>
}

function VehicleSection({ vehicles, refresh }: { vehicles: Vehicle[]; refresh: () => Promise<void> }) {
  const [make, setMake] = useState(''); const [model, setModel] = useState('')
  const [year, setYear] = useState(''); const [passengers, setPassengers] = useState('')
  const [luggage, setLuggage] = useState(''); const [registration, setRegistration] = useState('')
  const [comfort, setComfort] = useState(''); const [access, setAccess] = useState('')
  const [photos, setPhotos] = useState<Picked[]>([]); const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  const [requirements, setRequirements] = useState<VehicleRequirements | null>(null)
  const [evidence, setEvidence] = useState<Record<string, Picked>>({})
  const [blockStart, setBlockStart] = useState(''); const [blockEnd, setBlockEnd] = useState('')
  useEffect(() => { void getVehicleRequirements().then(setRequirements).catch((cause) => setError(cause instanceof Error ? cause.message : 'Could not load vehicle requirements.')) }, [])
  const pickPhotos = async () => {
    try { const picked = await chooseImages(true); setPhotos((current) => [...current, ...picked].slice(0, 8)) }
    catch { setError('Could not open your photo library.') }
  }
  const submit = async () => {
    setBusy(true); setError('')
    try {
      const form = new FormData()
      Object.entries({ make, model, year, passengerCapacity: passengers, luggageCapacity: luggage, registrationNumber: registration, comfortDetails: comfort, accessibilityDetails: access }).forEach(([key, value]) => form.append(key, value))
      photos.forEach((photo) => addFile(form, 'photo', photo))
      Object.entries(evidence).forEach(([key, file]) => addFile(form, `evidence:${key}`, file))
      await submitVehicle(form); setPhotos([]); await refresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not submit the vehicle listing.') }
    finally { setBusy(false) }
  }
  return <>
    <SectionTitle title="Your vehicles" detail="Only approved listings are shown to clients." />
    {vehicles.map((vehicle) => {
      const checklist = requirements?.requirements ?? []
      const missingCurrentEvidence = checklist.some((item) => !vehicle.media?.some((media) =>
        media.type === item.evidence_type && media.requirementVersion === item.version &&
        media.status === 'approved' && media.retentionExpiresAt != null && media.retentionExpiresAt > Date.now()))
      const reviewCorrectionOpen = ['needs_correction', 'pending_review', 'rejected'].includes(vehicle.status ?? '') ||
        (vehicle.status === 'approved' && missingCurrentEvidence)
      return <Card key={vehicle.id}>
      <ThemedText type="subtitle">{vehicle.year} {vehicle.make} {vehicle.model}</ThemedText>
      <ThemedText>Status · {vehicle.status?.replaceAll('_', ' ')}</ThemedText>
      {vehicle.applicantMessage ? <Message>{vehicle.applicantMessage}</Message> : null}
      {vehicle.media?.map((media) => <ThemedText key={media.id} type="small">{media.type.replaceAll('_', ' ')}{media.requirementVersion ? ` · v${media.requirementVersion}` : ''} · {media.status}{media.applicantMessage ? ` · ${media.applicantMessage}` : ''}</ThemedText>)}
      {reviewCorrectionOpen && vehicle.media?.filter((media) => media.status === 'rejected').map((media) => <VehicleCorrection key={media.id} vehicleId={vehicle.id} media={media} refresh={refresh} />)}
      {reviewCorrectionOpen && checklist
        .filter((item) => !vehicle.media?.some((media) => media.type === item.evidence_type && media.requirementVersion === item.version && media.status !== 'rejected' && media.retentionExpiresAt != null && media.retentionExpiresAt > Date.now()))
        .filter((item) => !vehicle.media?.some((media) => media.type === item.evidence_type && media.status === 'rejected'))
        .map((item) => <VehicleCorrection key={`${vehicle.id}-${item.evidence_type}`} vehicleId={vehicle.id} media={{ id: item.evidence_type, type: item.evidence_type, status: 'expired', applicantMessage: 'Current approved evidence is required.' }} refresh={refresh} />)}
      {vehicle.status === 'rejected' && !vehicle.media?.some((media) => media.status === 'rejected') ? <RejectedVehicleCorrection vehicle={vehicle} requirements={requirements?.requirements ?? []} refresh={refresh} /> : null}
      <VehicleEditForm vehicle={vehicle} refresh={refresh} />
    </Card>
    })}
    <Card>
      <ThemedText type="subtitle">Add a vehicle</ThemedText>
      <ThemedText>Use current photos of the exact vehicle. Hide registration plates, bystanders, and location details; approved photos are shown to clients. Unapproved uploads stay private. Vehicle checklist evidence accepts JPEG, PNG, WebP, or PDF files up to 8 MB each.</ThemedText>
      <View style={formStyles.row}><Field label="Make" value={make} onChangeText={setMake} placeholder="Toyota" /><Field label="Model" value={model} onChangeText={setModel} placeholder="Noah" /></View>
      <View style={formStyles.row}><Field label="Year" value={year} onChangeText={setYear} keyboardType="numeric" /><Field label="Passenger seats" value={passengers} onChangeText={setPassengers} keyboardType="numeric" /><Field label="Luggage" value={luggage} onChangeText={setLuggage} keyboardType="numeric" /></View>
      <Field label="Registration number" value={registration} onChangeText={setRegistration} autoCapitalize="characters" />
      <Field label="Comfort details" value={comfort} onChangeText={setComfort} multiline placeholder="Air conditioning, charging ports…" />
      <Field label="Accessibility details" value={access} onChangeText={setAccess} multiline placeholder="Step height, accessible features…" />
      <ActionButton title={`Add current vehicle photos (${photos.length}/2 minimum)`} onPress={() => void pickPhotos()} />
      {photos.map((photo, index) => <ThemedText key={`${photo.uri}-${index}`} type="small">Selected: {photo.fileName}</ThemedText>)}
      {requirements?.requirements.map((item) => <PickButton key={item.evidence_type} label={`${item.evidence_type.replaceAll('_', ' ')} · v${item.version}`} file={evidence[item.evidence_type]} onPress={() => void chooseEvidenceFile().then((file) => file && setEvidence((current) => ({ ...current, [item.evidence_type]: file }))).catch((cause) => setError(cause instanceof Error ? cause.message : 'Could not open your files.'))} />)}
      {!requirements?.readyToList ? <Message>Fave must publish an approved vehicle checklist and evidence retention policy before listings can be submitted.</Message> : <Message>Private evidence is reviewed by authorized staff. Only individual photos approved for clients can appear in vehicle search.</Message>}
      {error ? <Message error>{error}</Message> : null}
      <ActionButton title="Submit vehicle for review" onPress={() => void submit()} disabled={!requirements?.readyToList || !make || !model || !year || !passengers || !registration || !comfort || photos.length < 2 || requirements.requirements.some((item) => !evidence[item.evidence_type])} busy={busy} />
    </Card>
    {vehicles.filter((vehicle) => vehicle.status === 'approved').map((vehicle) => <AvailabilityCard key={vehicle.id} vehicle={vehicle} start={blockStart} end={blockEnd} setStart={setBlockStart} setEnd={setBlockEnd} />)}
  </>
}

function RejectedVehicleCorrection({ vehicle, requirements, refresh }: { vehicle: Vehicle; requirements: VehicleRequirements['requirements']; refresh: () => Promise<void> }) {
  const [photos, setPhotos] = useState<Picked[]>([])
  const [evidence, setEvidence] = useState<Record<string, Picked>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const addPhotos = async () => {
    try {
      const picked = await chooseImages(true)
      setPhotos((current) => [...current, ...picked].slice(0, 8))
    } catch {
      setError('Could not open your photo library.')
    }
  }

  const submit = async () => {
    if (photos.length === 0 && Object.keys(evidence).length === 0) return
    setBusy(true)
    setError('')
    try {
      const form = new FormData()
      photos.forEach((photo) => addFile(form, 'photo', photo))
      Object.entries(evidence).forEach(([type, file]) => addFile(form, `evidence:${type}`, file))
      await submitVehicleCorrections(vehicle.id, form)
      setPhotos([])
      setEvidence({})
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not submit replacement vehicle evidence.')
    } finally {
      setBusy(false)
    }
  }

  return <View style={styles.correction}>
    <Message>Listing rejected{vehicle.applicantMessage ? `: ${vehicle.applicantMessage}` : '. Submit replacement photos or documents to request another review.'}</Message>
    <ActionButton title={`Add replacement vehicle photos (${photos.length}/8)`} onPress={() => void addPhotos()} disabled={busy} />
    {photos.map((photo, index) => <ThemedText key={`${photo.uri}-${index}`} type="small">Selected: {photo.fileName}</ThemedText>)}
    {requirements.map((item) => <PickButton
      key={item.evidence_type}
      label={`Replacement ${item.evidence_type.replaceAll('_', ' ')}`}
      file={evidence[item.evidence_type]}
      onPress={() => void chooseEvidenceFile()
        .then((file) => file && setEvidence((current) => ({ ...current, [item.evidence_type]: file })))
        .catch((cause) => setError(cause instanceof Error ? cause.message : 'Could not open your files.'))}
    />)}
    {error ? <Message error>{error}</Message> : null}
    <ActionButton
      title="Submit listing corrections"
      onPress={() => void submit()}
      disabled={busy || (photos.length === 0 && Object.keys(evidence).length === 0)}
      busy={busy}
    />
  </View>
}

function VehicleEditForm({ vehicle, refresh }: { vehicle: Vehicle; refresh: () => Promise<void> }) {
  const [editing, setEditing] = useState(false)
  const [make, setMake] = useState(vehicle.make); const [model, setModel] = useState(vehicle.model)
  const [year, setYear] = useState(String(vehicle.year)); const [passengers, setPassengers] = useState(String(vehicle.passengerCapacity))
  const [luggage, setLuggage] = useState(String(vehicle.luggageCapacity)); const [registration, setRegistration] = useState(vehicle.registrationNumber ?? '')
  const [comfort, setComfort] = useState(vehicle.comfortDetails); const [access, setAccess] = useState(vehicle.accessibilityDetails)
  const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  const save = async () => {
    setBusy(true); setError('')
    try {
      await updateVehicle(vehicle.id, { make, model, year: Number(year), passengerCapacity: Number(passengers), luggageCapacity: Number(luggage), registrationNumber: registration, comfortDetails: comfort, accessibilityDetails: access })
      setEditing(false); await refresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not update the vehicle.') }
    finally { setBusy(false) }
  }
  return <View style={styles.correction}>
    <ActionButton title={editing ? 'Cancel vehicle edits' : 'Edit vehicle details'} onPress={() => setEditing(!editing)} />
    {editing ? <>
      <Message>{vehicle.status === 'rejected' ? 'Saving corrections will resubmit this rejected listing for staff review.' : 'Changes to an approved vehicle pause its client listing until staff review it again.'}</Message>
      <View style={formStyles.row}><Field label="Make" value={make} onChangeText={setMake} /><Field label="Model" value={model} onChangeText={setModel} /></View>
      <View style={formStyles.row}><Field label="Year" value={year} onChangeText={setYear} keyboardType="numeric" /><Field label="Passenger seats" value={passengers} onChangeText={setPassengers} keyboardType="numeric" /><Field label="Luggage" value={luggage} onChangeText={setLuggage} keyboardType="numeric" /></View>
      <Field label="Registration number" value={registration} onChangeText={setRegistration} autoCapitalize="characters" />
      <Field label="Comfort details" value={comfort} onChangeText={setComfort} multiline />
      <Field label="Accessibility details" value={access} onChangeText={setAccess} multiline />
      {error ? <Message error>{error}</Message> : null}
      <ActionButton title="Save listing details" onPress={() => void save()} busy={busy} />
    </> : null}
  </View>
}

function VehicleCorrection({ vehicleId, media, refresh }: { vehicleId: string; media: NonNullable<Vehicle['media']>[number]; refresh: () => Promise<void> }) {
  const [file, setFile] = useState<Picked | null>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  const isPhoto = media.type === 'client_photo'
  const choose = async () => {
    try { setFile(isPhoto ? (await chooseImages())[0] ?? null : await chooseEvidenceFile()) }
    catch (cause) { setError(cause instanceof Error ? cause.message : isPhoto ? 'Could not open your photo library.' : 'Could not open your files.') }
  }
  const submit = async () => {
    if (!file) return
    setBusy(true); setError('')
    try {
      const form = new FormData()
      addFile(form, isPhoto ? 'photo' : `evidence:${media.type}`, file)
      await submitVehicleCorrections(vehicleId, form)
      setFile(null); await refresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not submit replacement evidence.') }
    finally { setBusy(false) }
  }
  return <View style={styles.correction}>
    <Message>Correction needed for {media.type.replaceAll('_', ' ')}{media.applicantMessage ? `: ${media.applicantMessage}` : '.'}</Message>
    <PickButton label={`Replacement ${isPhoto ? 'vehicle photo' : 'document'}`} file={file ?? undefined} onPress={() => void choose()} />
    {error ? <Message error>{error}</Message> : null}
    <ActionButton title="Send replacement for review" onPress={() => void submit()} disabled={!file} busy={busy} />
  </View>
}

function AvailabilityCard({ vehicle, start, end, setStart, setEnd }: { vehicle: Vehicle; start: string; end: string; setStart: (value: string) => void; setEnd: (value: string) => void }) {
  const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false)
  const [removingBlockId, setRemovingBlockId] = useState<string | null>(null)
  const [availability, setAvailability] = useState<VehicleAvailability | null>(null)
  const refresh = useCallback(() => getVehicleAvailability(vehicle.id).then(setAvailability).catch((cause) => setMessage(cause instanceof Error ? cause.message : 'Could not load availability.')), [vehicle.id])
  useEffect(() => { void Promise.resolve().then(refresh) }, [refresh])
  return <Card>
    <ThemedText type="subtitle">Availability · {vehicle.make} {vehicle.model}</ThemedText>
    <ThemedText>Current holds and confirmed booking dates stay visible only to you.</ThemedText>
    <Field label="Unavailable from (YYYY-MM-DD)" value={start} onChangeText={setStart} placeholder="2026-10-01" />
    <Field label="Available again (YYYY-MM-DD)" value={end} onChangeText={setEnd} placeholder="2026-10-03" />
    {availability?.unavailable.map((range) => <View key={range.id} style={styles.availabilityRow}>
      <ThemedText type="small">Unavailable · {range.start_date} to {range.end_date}</ThemedText>
      <ActionButton
        title="Remove block"
        disabled={busy && removingBlockId !== range.id}
        busy={busy && removingBlockId === range.id}
        onPress={() => {
          setBusy(true); setRemovingBlockId(range.id); setMessage('')
          void removeUnavailable(vehicle.id, range.id)
            .then(() => { setMessage('Unavailable date block removed.'); return refresh() })
            .catch((cause) => setMessage(cause instanceof Error ? cause.message : 'Could not remove this date block.'))
            .finally(() => { setBusy(false); setRemovingBlockId(null) })
        }}
      />
    </View>)}
    {availability?.holdsAndBookings.map((range, index) => <ThemedText key={`${range.start_date}-${index}`} type="small">{range.status === 'confirmed' ? 'Confirmed trip' : 'Deposit hold'} · {range.start_date} to {range.end_date}{range.status === 'deposit_pending' ? ` · expires ${new Date(range.hold_expires_at).toLocaleString()}` : ''}</ThemedText>)}
    {message ? <Message>{message}</Message> : null}
    <ActionButton title="Mark dates unavailable" disabled={!start || !end} busy={busy} onPress={() => { setBusy(true); setMessage(''); void markUnavailable(vehicle.id, start, end).then(() => { setMessage('Dates marked unavailable.'); return refresh() }).catch((cause) => setMessage(cause instanceof Error ? cause.message : 'Could not update availability.')).finally(() => setBusy(false)) }} />
  </Card>
}

const styles = StyleSheet.create({
  page: { flex: 1 }, loading: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  content: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', padding: Spacing.three, paddingBottom: BottomTabInset + Spacing.five, gap: Spacing.three },
  document: { gap: Spacing.two, padding: Spacing.three, backgroundColor: '#fff', borderRadius: 12 },
  correction: { gap: Spacing.two, paddingTop: Spacing.two, borderTopWidth: 1, borderTopColor: '#b8bbc2' },
  availabilityRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  pickWrap: { flex: 1, minWidth: 140, gap: Spacing.two }, preview: { width: '100%', height: 120, borderRadius: 12, backgroundColor: '#ddd' },
})
