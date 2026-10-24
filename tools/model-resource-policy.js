const MODEL_PROFILES = Object.freeze({
  off: { id: 'off', label: '基础分析（不加载视觉大模型）', model: null, minRamGiB: 0, minVramGiB: 0, estimatedVramGiB: 0, speed: '最快', advice: '适合低配置或同时运行其他软件；没有大模型自然语言复核。' },
  'gemma3:4b': { id: 'gemma3:4b', label: 'Gemma 3 4B（兼容基线）', model: 'gemma3:4b', minRamGiB: 8, minVramGiB: 6, estimatedVramGiB: 4, speed: '较快', advice: '适合多数电脑；用于兼容性基线，中文描述稳定性需以本机为准。' },
  'qwen3.5:4b': { id: 'qwen3.5:4b', label: 'Qwen 3.5 4B（推荐平衡）', model: 'qwen3.5:4b', minRamGiB: 8, minVramGiB: 6, estimatedVramGiB: 4, speed: '较快', advice: '推荐默认选择；在速度、资源和图像语义之间取平衡。' },
  'qwen3.5:9b': { id: 'qwen3.5:9b', label: 'Qwen 3.5 9B（精度优先）', model: 'qwen3.5:9b', minRamGiB: 12, minVramGiB: 9, estimatedVramGiB: 8, speed: '较慢', advice: '只建议内存32GB、独显空闲约9GiB以上时主动选择；不作为低配默认。' },
})

const measured9bDigest = '56671c2ab9385f9cfcb404638e32cd62d88e3501d44822208363c010179a3c90'
const calibratedProfile = (profile, details = []) => profile.id === 'qwen3.5:9b' && details.some(item => (item.name === profile.id || item.model === profile.id) && item.digest === measured9bDigest)
  ? { ...profile, minVramGiB: 7.5, estimatedVramGiB: 5.3, advice: '此权重已测GPU驻留约5.3GiB；建议空闲显存至少7.5GiB、空闲内存12GiB。仅主动选择，运行仍检查显存和GPU驻留；其他权重保守采用9GiB门槛。' }
  : profile

export const modelProfiles = (installedDetails = []) => Object.values(MODEL_PROFILES).map(profile => calibratedProfile(profile, installedDetails))
export const getModelProfile = id => MODEL_PROFILES[id] ?? MODEL_PROFILES.off
export const normalizeModelChoice = id => id === 'auto' || !id ? 'qwen3.5:4b' : (MODEL_PROFILES[id] ? id : 'off')

export function summarizeResources({ totalRamBytes = 0, freeRamBytes = 0, totalVramBytes = 0, freeVramBytes = 0 } = {}) {
  const gib = value => Math.max(0, Number(value) || 0) / 1024 ** 3
  return { totalRamGiB: Number(gib(totalRamBytes).toFixed(1)), freeRamGiB: Number(gib(freeRamBytes).toFixed(1)), totalVramGiB: Number(gib(totalVramBytes).toFixed(1)), freeVramGiB: Number(gib(freeVramBytes).toFixed(1)) }
}

export function chooseSafeModel({ requested = 'auto', installed = [], installedDetails = [], resident = [], resources = {}, force = false } = {}) {
  const wanted = normalizeModelChoice(requested)
  const available = new Set(installed)
  const ram = Number(resources.freeRamGiB) || 0
  const vram = Number(resources.freeVramGiB) || 0
  const canRun = profile => {
    if (profile.id === 'off') return true
    const loaded = resident.find(item => item.name === profile.id || item.model === profile.id)
    const occupied = Number(loaded?.size_vram ?? 0) / 1024 ** 3
    const fullyOnGpu = !loaded || occupied > 0 && occupied >= Number(loaded.size ?? 0) / 1024 ** 3 * 0.9
    const residentRamHeadroom = loaded && fullyOnGpu ? 3 : profile.minRamGiB
    const residentVramHeadroom = loaded && fullyOnGpu ? 0.75 : profile.minVramGiB
    return available.has(profile.id) && fullyOnGpu && ram >= residentRamHeadroom && vram >= residentVramHeadroom && (loaded && fullyOnGpu ? true : vram + occupied >= profile.minVramGiB)
  }
  const wantedProfile = calibratedProfile(getModelProfile(wanted), installedDetails)
  if (force && wantedProfile.id !== 'off' && available.has(wantedProfile.id)) return { selected: wantedProfile.id, requested: wanted, forced: true, fallback: false, reason: '用户已确认强制使用，忽略资源建议；运行失败时不会自动换模型' }
  if (canRun(wantedProfile)) return { selected: wantedProfile.id, requested: wanted, fallback: false, reason: '资源与安装状态满足策略' }
  for (const candidate of ['qwen3.5:4b', 'gemma3:4b', 'off']) {
    const profile = getModelProfile(candidate)
    if (canRun(profile)) return { selected: profile.id, requested: wanted, fallback: true, reason: wantedProfile.id === 'off' ? '已选择基础分析' : '所选模型未安装或当前资源不足，已安全降级' }
  }
  return { selected: 'off', requested: wanted, fallback: true, reason: '当前资源不足，使用基础分析保护电脑' }
}

export function resourceWarning(profile, resources = {}) {
  if (!profile || profile.id === 'off') return null
  const ram = Number(resources.freeRamGiB) || 0
  const vram = Number(resources.freeVramGiB) || 0
  if (ram < profile.minRamGiB || vram < profile.minVramGiB) return `当前可用资源不足以安全运行 ${profile.label}，建议选择基础分析或4B模型。`
  return null
}
