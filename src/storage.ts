export type StoredPhoto = {
  id: string
  title: string
  label: 'person' | 'landscape' | 'other' | 'review'
  score: number | null
  reason: string
  meta: string
  clarityScore: number
  clarityVariance: number
  meanBrightness: number
  underexposureRatio: number
  overexposureRatio: number
  exposureStatus: 'balanced' | 'underexposed' | 'overexposed' | 'mixed'
  lowQuality: boolean
  qualityReasons: string[]
  dHash?: string
  pHash?: string
  similarityGroupId?: string
  similarityDistance?: number
  isNearDuplicate?: boolean
  clipSimilarityToRepresentative?: number
  clipSimilarityStatus?: 'not-run' | 'running' | 'succeeded' | 'failed'
  clipSimilarityDurationMs?: number
  clipSimilarityError?: string
  clipRepresentativeId?: string
  clipRepresentativeTitle?: string
  normalizedWidth?: number
  normalizedHeight?: number
  normalizationMode?: 'letterbox'
  normalizationScale?: number
  normalizationOffsetX?: number
  normalizationOffsetY?: number
  modelLabel?: string
  modelScore?: number
  modelDevice?: 'webgpu' | 'wasm'
  modelId?: string
  modelTopK?: Array<{ label: string; score: number }>
  modelDurationMs?: number
  modelStatus?: 'not-run' | 'succeeded' | 'failed'
  modelError?: string
  productLabel?: 'person' | 'landscape' | 'other' | 'review'
  productLabelConfidence?: number
  productLabelReason?: string
  faceCount?: number
  faceAreaRatio?: number
  faceMaxConfidence?: number
  faceDetections?: Array<{ score: number; x: number; y: number; width: number; height: number }>
  faceDetectionDurationMs?: number
  faceDetectionStatus?: 'not-run' | 'succeeded' | 'failed'
  faceDetectionError?: string
  faceLandmarkCount?: number
  faceLandmarkPointCounts?: number[]
  faceBlendshapeCounts?: number[]
  closedEyeRisk?: number
  closedEyeStatus?: 'not-run' | 'no-face' | 'insufficient-data' | 'low' | 'review'
  closedEyeFaceResults?: Array<{ risk: number; status: 'insufficient-data' | 'low' | 'review'; leftScore?: number; rightScore?: number }>
  faceLandmarkerDurationMs?: number
  faceLandmarkerStatus?: 'not-run' | 'succeeded' | 'failed'
  faceLandmarkerError?: string
  width: number
  height: number
  thumbnail: Blob
  createdAt: number
}

const DB_NAME = 'lenssort-ai'
export type CurationState = {
  feedback: Record<string, 'keep' | 'skip'>
  groupChoices: Record<string, string>
  sentiment: Record<string, 'like' | 'dislike'>
}

export type FeedbackEventType =
  | 'like'
  | 'dislike'
  | 'clear-sentiment'
  | 'keep'
  | 'skip'
  | 'clear-feedback'
  | 'choose-candidate'
  | 'reset-candidate'
  | 'reset-preferences'

export type FeedbackEvent = {
  id: string
  photoId: string
  photoTitle?: string
  groupId?: string
  type: FeedbackEventType
  previousValue?: string
  nextValue?: string
  affectedPhotoIds?: string[]
  createdAt: number
  sequence: number
}

const DB_VERSION = 3
const PHOTO_STORE = 'photos'
const CURATION_STORE = 'curation'
const FEEDBACK_EVENTS_STORE = 'feedbackEvents'

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(PHOTO_STORE)) {
        database.createObjectStore(PHOTO_STORE, { keyPath: 'id' })
      }
      if (!database.objectStoreNames.contains(CURATION_STORE)) {
        database.createObjectStore(CURATION_STORE)
      }
      if (!database.objectStoreNames.contains(FEEDBACK_EVENTS_STORE)) {
        database.createObjectStore(FEEDBACK_EVENTS_STORE, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close()
      resolve(request.result)
    }
    request.onerror = () => reject(request.error ?? new Error('无法打开本地照片存储'))
  })
}

export async function savePhotos(photos: StoredPhoto[]) {
  if (photos.length === 0) return
  const database = await openDatabase()
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(PHOTO_STORE, 'readwrite')
    const store = transaction.objectStore(PHOTO_STORE)
    photos.forEach((photo) => store.put(photo))
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('无法保存本地照片'))
    transaction.onabort = () => reject(transaction.error ?? new Error('本地照片保存已取消'))
  }).finally(() => database.close())
}

export async function loadPhotos() {
  const database = await openDatabase()
  return new Promise<StoredPhoto[]>((resolve, reject) => {
    const transaction = database.transaction(PHOTO_STORE, 'readonly')
    const request = transaction.objectStore(PHOTO_STORE).getAll()
    request.onsuccess = () => resolve(request.result as StoredPhoto[])
    request.onerror = () => reject(request.error ?? new Error('无法读取本地照片'))
    transaction.oncomplete = () => database.close()
    transaction.onerror = () => reject(transaction.error ?? new Error('无法读取本地照片'))
  })
}

export async function clearPhotos() {
  const database = await openDatabase()
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction([PHOTO_STORE, CURATION_STORE, FEEDBACK_EVENTS_STORE], 'readwrite')
    transaction.objectStore(PHOTO_STORE).clear()
    transaction.objectStore(CURATION_STORE).clear()
    transaction.objectStore(FEEDBACK_EVENTS_STORE).clear()
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('无法清除本地照片'))
    transaction.onabort = () => reject(transaction.error ?? new Error('本地照片清除已取消'))
  }).finally(() => database.close())
}

export async function loadCurationState(): Promise<CurationState> {
  const database = await openDatabase()
  return new Promise<CurationState>((resolve, reject) => {
    const transaction = database.transaction(CURATION_STORE, 'readonly')
    const request = transaction.objectStore(CURATION_STORE).get('current')
    request.onsuccess = () => {
      const state = request.result as Partial<CurationState> | undefined
      resolve({ feedback: state?.feedback ?? {}, groupChoices: state?.groupChoices ?? {}, sentiment: state?.sentiment ?? {} })
    }
    request.onerror = () => reject(request.error ?? new Error('无法读取本地选择'))
    transaction.oncomplete = () => database.close()
    transaction.onerror = () => reject(transaction.error ?? new Error('本地选择读取失败'))
    transaction.onabort = () => reject(transaction.error ?? new Error('本地选择读取已取消'))
  }).finally(() => database.close())
}

export async function loadFeedbackEvents() {
  const database = await openDatabase()
  return new Promise<FeedbackEvent[]>((resolve, reject) => {
    const transaction = database.transaction(FEEDBACK_EVENTS_STORE, 'readonly')
    const request = transaction.objectStore(FEEDBACK_EVENTS_STORE).getAll()
    request.onsuccess = () => resolve((request.result as FeedbackEvent[]).sort((left, right) => left.createdAt - right.createdAt || left.sequence - right.sequence))
    request.onerror = () => reject(request.error ?? new Error('无法读取本地反馈事件'))
    transaction.oncomplete = () => database.close()
    transaction.onerror = () => reject(transaction.error ?? new Error('本地反馈事件读取失败'))
    transaction.onabort = () => reject(transaction.error ?? new Error('本地反馈事件读取已取消'))
  })
}

export async function appendFeedbackEvent(event: FeedbackEvent) {
  const database = await openDatabase()
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(FEEDBACK_EVENTS_STORE, 'readwrite')
    transaction.objectStore(FEEDBACK_EVENTS_STORE).add(event)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('无法保存本地反馈事件'))
    transaction.onabort = () => reject(transaction.error ?? new Error('本地反馈事件保存已取消'))
  }).finally(() => database.close())
}

export async function saveCurationState(state: CurationState, event?: FeedbackEvent) {
  const database = await openDatabase()
  await new Promise<void>((resolve, reject) => {
    const stores = event ? [CURATION_STORE, FEEDBACK_EVENTS_STORE] : [CURATION_STORE]
    const transaction = database.transaction(stores, 'readwrite')
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('无法保存本地选择'))
    transaction.onabort = () => reject(transaction.error ?? new Error('本地选择保存已取消'))
    try {
      transaction.objectStore(CURATION_STORE).put(state, 'current')
      if (event) transaction.objectStore(FEEDBACK_EVENTS_STORE).add(event)
    } catch (error) {
      transaction.abort()
      reject(error)
    }
  }).finally(() => database.close())
}
