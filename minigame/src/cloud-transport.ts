import { RoomRequest, RoomResponse } from '../../client/assets/scripts/online/protocol';
import { RoomTransport } from './online-session';

/**
 * 云开发环境 ID。只有一个环境时留空即可（使用默认环境）；有多个环境时填上要用的那个，
 * 例如 'cloud1-0g1a2b3c4d5e6f7g'。
 */
export const CLOUD_ENV_ID = '';

/** The room cloud function and the player's inbox through wx.cloud; null when cloud development is unavailable. */
export function createCloudTransport(): RoomTransport | null {
  const cloud = wx.cloud;
  if (cloud === undefined) return null;
  try {
    cloud.init(CLOUD_ENV_ID === '' ? { traceUser: true } : { env: CLOUD_ENV_ID, traceUser: true });
  } catch {
    return null;
  }
  return {
    async call(request: RoomRequest): Promise<RoomResponse> {
      const result = await cloud.callFunction({ name: 'room', data: request });
      return result.result as RoomResponse;
    },
    watch(onPoke, onError) {
      // Only the player's own inbox doc is readable ('{openid}' is filled in by the database).
      const watcher = cloud.database().collection('inbox').where({ _openid: '{openid}' }).watch({
        onChange: () => onPoke(),
        onError: () => onError(),
      });
      return () => { void watcher.close(); };
    },
  };
}
