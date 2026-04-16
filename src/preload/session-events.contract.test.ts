import type { ProfileStatus, SessionInfo } from '../main/models'
import type { LuxAPI, SessionStartedEvent, SessionStateEvent, SessionStoppedEvent } from './api-contract'

type Assert<T extends true> = T
type IsExact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
type CallbackPayload<T> = T extends (data: infer Data) => void ? Data : never

type ExpectedSessionStoppedEvent = {
  profile_id: SessionInfo['profile_id']
  exit_code: number | null
}

type ExpectedSessionStateEvent = {
  profile_id: SessionInfo['profile_id']
  status: ProfileStatus
  error?: string
}

type SessionStartedEventMatchesMainModel = Assert<IsExact<SessionStartedEvent, SessionInfo>>
type SessionStartedCallbackMatchesMainModel = Assert<
  IsExact<CallbackPayload<Parameters<LuxAPI['onSessionStarted']>[0]>, SessionInfo>
>
type SessionStoppedCallbackMatchesContract = Assert<
  IsExact<CallbackPayload<Parameters<LuxAPI['onSessionStopped']>[0]>, SessionStoppedEvent>
>
type SessionStoppedEventMatchesExpectedShape = Assert<
  IsExact<SessionStoppedEvent, ExpectedSessionStoppedEvent>
>
type SessionStateCallbackMatchesContract = Assert<
  IsExact<CallbackPayload<Parameters<LuxAPI['onSessionState']>[0]>, SessionStateEvent>
>
type SessionStateEventMatchesExpectedShape = Assert<
  IsExact<SessionStateEvent, ExpectedSessionStateEvent>
>

declare const sessionStartedEventMatchesMainModel: SessionStartedEventMatchesMainModel
declare const sessionStartedCallbackMatchesMainModel: SessionStartedCallbackMatchesMainModel
declare const sessionStoppedCallbackMatchesContract: SessionStoppedCallbackMatchesContract
declare const sessionStoppedEventMatchesExpectedShape: SessionStoppedEventMatchesExpectedShape
declare const sessionStateCallbackMatchesContract: SessionStateCallbackMatchesContract
declare const sessionStateEventMatchesExpectedShape: SessionStateEventMatchesExpectedShape

void sessionStartedEventMatchesMainModel
void sessionStartedCallbackMatchesMainModel
void sessionStoppedCallbackMatchesContract
void sessionStoppedEventMatchesExpectedShape
void sessionStateCallbackMatchesContract
void sessionStateEventMatchesExpectedShape

declare const api: LuxAPI

api.onSessionStarted((data) => {
  const sessionInfo: SessionInfo = data
  void sessionInfo

  // @ts-expect-error session started payload should not expose exit_code.
  const exitCode = data.exit_code
  void exitCode
})

// @ts-expect-error onSessionStopped callback payload must be the stopped event object.
api.onSessionStopped((data: string) => {
  void data
})

api.onSessionState((data) => {
  const status: ProfileStatus = data.status
  void status
})

// @ts-expect-error onSessionState callback payload must be the state event object.
api.onSessionState((data: number) => {
  void data
})