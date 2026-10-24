const finiteOrNull = value => Number.isFinite(value) ? value : null

export function buildModelEvidence({ classification, candidates, scene, person, faces, quality, backend, device, npuVerified, npuEvidence }) {
  const safeCandidates = Array.isArray(candidates) ? candidates.map(candidate => ({
    label: typeof candidate?.label === 'string' ? candidate.label : null,
    score: finiteOrNull(candidate?.score),
  })) : []
  const faceCount = Number.isInteger(faces?.faceCount) && faces.faceCount >= 0 ? faces.faceCount : null
  return {
    version: 1,
    classification: {
      category: classification?.category ?? '待确认',
      confidence: finiteOrNull(classification?.confidence),
      reason: classification?.reason ?? '缺少分类依据',
    },
    person: {
      status: person?.status ?? 'not-run',
      source: person?.source ?? 'YOLOX Tiny',
      candidateCount: Number.isInteger(person?.candidateCount) ? person.candidateCount : null,
      maxScore: finiteOrNull(person?.maxScore),
      boxes: Array.isArray(person?.boxes) ? person.boxes : [],
      durationMs: finiteOrNull(person?.durationMs),
      error: person?.error ?? null,
    },
    face: {
      status: faces ? (faceCount === null ? 'invalid' : 'succeeded') : 'unavailable',
      source: 'MediaPipe Face Detector',
      count: faceCount,
      maxConfidence: finiteOrNull(faces?.maxConfidence),
      areaRatio: finiteOrNull(faces?.faceAreaRatio),
      durationMs: finiteOrNull(faces?.durationMs),
    },
    scene: {
      status: scene?.status ?? (safeCandidates.length ? 'succeeded' : 'unavailable'),
      source: scene?.source ?? 'MobileNetV4',
      topLabel: scene?.topLabel ?? safeCandidates[0]?.label ?? null,
      topScore: finiteOrNull(scene?.topScore ?? safeCandidates[0]?.score),
      candidates: Array.isArray(scene?.candidates) ? scene.candidates : safeCandidates,
      error: scene?.error ?? null,
      reason: scene?.reason ?? null,
    },
    aesthetic: {
      status: 'not-run',
      source: 'LAION aesthetic V1（P3 待接入）',
      score: null,
      normalizedScore: null,
    },
    technical: {
      qualityScore: finiteOrNull(quality?.qualityScore),
      clarityScore: finiteOrNull(quality?.clarityScore),
      exposureStatus: quality?.exposureStatus ?? null,
      qualityReasons: Array.isArray(quality?.qualityReasons) ? [...quality.qualityReasons] : [],
    },
    duplicate: {
      status: 'not-run',
      source: '视觉指纹（精选阶段计算）',
      groupId: null,
    },
    device: {
      backend: backend ?? null,
      id: device?.id ?? null,
      name: device?.name ?? null,
      npuVerified: npuVerified === true,
      npuProviders: Array.isArray(npuEvidence?.providers) ? [...npuEvidence.providers] : [],
      mixedCpuAuxiliary: npuEvidence?.mixedCpuAuxiliary === true,
      npuKernelCount: Number.isFinite(npuEvidence?.npuKernelCount) ? npuEvidence.npuKernelCount : null,
      npuKernelMs: Number.isFinite(npuEvidence?.npuKernelMs) ? npuEvidence.npuKernelMs : null,
      profileScope: npuEvidence?.profileScope ?? null,
      cpuKernelCount: Number.isFinite(npuEvidence?.cpuKernelCount) ? npuEvidence.cpuKernelCount : null,
      cpuKernelMs: Number.isFinite(npuEvidence?.cpuKernelMs) ? npuEvidence.cpuKernelMs : null,
    },
  }
}
