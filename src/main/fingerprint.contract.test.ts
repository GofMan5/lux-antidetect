import type { BrowserType } from './models'
import { generateFingerprintForApi } from './fingerprint'
import type { LuxAPI } from '../preload/api-contract'

type Assert<T extends true> = T
type IsExact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false

type MainGenerateFingerprintParams = Parameters<typeof generateFingerprintForApi>
type PreloadGenerateFingerprintParams = Parameters<LuxAPI['generateFingerprint']>

type MainContractUsesOnlyBrowserType = Assert<
  IsExact<MainGenerateFingerprintParams, [BrowserType]>
>
type PreloadContractUsesOnlyBrowserType = Assert<
  IsExact<PreloadGenerateFingerprintParams, [BrowserType]>
>

declare const mainContractUsesOnlyBrowserType: MainContractUsesOnlyBrowserType
declare const preloadContractUsesOnlyBrowserType: PreloadContractUsesOnlyBrowserType

void mainContractUsesOnlyBrowserType
void preloadContractUsesOnlyBrowserType

// Compile-time regression guard: the removed osHint argument must stay removed.
// @ts-expect-error generateFingerprintForApi accepts only browserType.
generateFingerprintForApi('chromium', 'windows')

declare const api: LuxAPI

// @ts-expect-error window.api.generateFingerprint accepts only browserType.
api.generateFingerprint('chromium', 'windows')