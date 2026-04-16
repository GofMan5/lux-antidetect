import type { BrowserType } from './models'
import type { LuxAPI } from '../preload/api-contract'

type Assert<T extends true> = T
type IsExact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false

type PreloadGenerateFingerprintParams = Parameters<LuxAPI['generateFingerprint']>

type PreloadContractUsesOnlyBrowserType = Assert<
  IsExact<PreloadGenerateFingerprintParams, [BrowserType]>
>

declare const preloadContractUsesOnlyBrowserType: PreloadContractUsesOnlyBrowserType
void preloadContractUsesOnlyBrowserType

declare const api: LuxAPI

// @ts-expect-error window.api.generateFingerprint accepts only browserType.
api.generateFingerprint('chromium', 'windows')