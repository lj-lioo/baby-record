// 亲友身份与邀请（v1.13.0 一期）
// 本机角色 memberRole 决定 UI 权限；全家仍共用同步密钥（由爸妈另行告知，绝不写入邀请 URL）。
// 二期加固：服务端成员表、吊销、邀请签名与同步密钥解耦、只读不再下发完整密钥。
import { store } from './store.js';
import { b64u, unb64u, extractSyncKey } from './sync-core.js';
import { toast, openSheet, closeSheet, esc } from './ui.js';

export const ROLES = ['爸爸', '妈妈', '爷爷', '奶奶', '姥姥', '姥爷'];
export const ADMIN_ROLES = ['爸爸', '妈妈'];
export const ELDER_ROLES = ['爷爷', '奶奶', '姥姥', '姥爷'];

const INVITE_LS = 'babyrecord.inviteSecret';
const INVITE_TTL_MS = 7 * 864e5; // 邀请默认 7 天有效
const te = new TextEncoder();

export function isValidRole(r) { return ROLES.includes(r); }
export function getRole() {
  const r = store.state.settings.memberRole || '';
  return isValidRole(r) ? r : '';
}
export function hasRole() { return !!getRole(); }
export function isAdmin() { return ADMIN_ROLES.includes(getRole()); }
export function isElder() { return ELDER_ROLES.includes(getRole()); }

/** 无角色时视为管理员开局（首装引导会优先选爸妈）；已选老人则收紧 */
export function canEditEvents() { const r = getRole(); return !r || isAdmin(); }
export function canSetAlarm() { return canEditEvents(); }
export function canEditPlans() { return canEditEvents(); } // 疫苗/体检计划、改计划日
export function canEditGrowth() { return canEditEvents(); } // 生长/用药增删改
export function canEditProfile() { return canEditEvents(); }
export function canEditDangerousSettings() { return canEditEvents(); } // 同步密钥、照片服务、清空等
export function canInvite() { return isAdmin(); }
export function canUploadAlbum() { return true; } // 一期：六种身份都可上传
export function canDownloadAlbum() { return true; }
export function canDeleteAlbum() { return canEditEvents(); } // 老人不可删

export function setRole(role) {
  if (!isValidRole(role)) throw new Error('身份无效');
  store.updateSettings({ memberRole: role });
  return role;
}

export function roleLabel(role = getRole()) {
  if (!role) return '未选择';
  return role;
}

export function roleCapabilityText(role = getRole()) {
  if (ADMIN_ROLES.includes(role)) {
    return '爸爸/妈妈：全部权限（事项、疫苗/体检/生长/用药、相册、设置、邀请亲友）。';
  }
  if (ELDER_ROLES.includes(role)) {
    return `${role}：可浏览全部板块；相册可上传、保存缩略图到系统相册；不能新建/修改事项、改计划、设闹钟，也不能改宝宝资料、同步密钥与照片服务。`;
  }
  return '请选择身份。';
}

function deny(msg = '当前身份没有这项权限（请用爸爸/妈妈的手机操作，或让管理员发邀请改身份）') {
  toast(msg, 3500);
  return false;
}

/** 操作前检查；不允许则 toast 并返回 false */
export function requireEditEvents(msg) {
  if (canEditEvents()) return true;
  return deny(msg || '爷爷奶奶等亲友不能新建或修改事项');
}
export function requireAlarm() {
  if (canSetAlarm()) return true;
  return deny('当前身份不能设闹钟提醒');
}
export function requireDangerousSettings() {
  if (canEditDangerousSettings()) return true;
  return deny('当前身份不能修改这项设置');
}

// —— 邀请签名材料（绝不把同步密钥写进 URL）——
function readSyncKeyLocal() {
  try {
    const m = JSON.parse(localStorage.getItem('babyrecord.sync') || '{}');
    return extractSyncKey(m.key || '') || '';
  } catch { return ''; }
}

function localInviteSecret() {
  try {
    let s = localStorage.getItem(INVITE_LS);
    if (!s) {
      s = b64u(crypto.getRandomValues(new Uint8Array(32)));
      localStorage.setItem(INVITE_LS, s);
    }
    return s;
  } catch {
    return 'baby-record-invite-fallback';
  }
}

async function importHmacKey(rawBytes) {
  return crypto.subtle.importKey('raw', rawBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

/** 优先用同步密钥派生签名钥；无同步时用本机 inviteSecret（跨设备校验弱，二期加固） */
async function signingKeyBytes() {
  const syncKey = readSyncKeyLocal();
  if (syncKey) {
    const raw = unb64u(syncKey.slice('brs1_'.length));
    const base = await crypto.subtle.importKey('raw', raw, 'HKDF', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt: te.encode('baby-record-invite/v1'), info: te.encode('invite-sig') },
      base, 256,
    );
    return new Uint8Array(bits);
  }
  // 二期：不要依赖本机 secret；一期无同步时仅防随手改 URL（同源设备可验）
  return te.encode('br-invite|' + localInviteSecret());
}

async function signPayload(payload) {
  const key = await importHmacKey(await signingKeyBytes());
  const sig = await crypto.subtle.sign('HMAC', key, te.encode(payload));
  return b64u(new Uint8Array(sig).slice(0, 16));
}

async function verifyPayload(payload, sig) {
  if (!sig) return false;
  try {
    const expect = await signPayload(payload);
    return expect === sig;
  } catch { return false; }
}

/**
 * 生成邀请链接（hash 路由）。不含同步密钥。
 * @returns {{ url: string, role: string, exp: number }}
 */
export async function createInvite(role, { ttlMs = INVITE_TTL_MS } = {}) {
  if (!canInvite()) throw new Error('只有爸爸/妈妈可以生成邀请链接');
  if (!isValidRole(role)) throw new Error('身份无效');
  const exp = Date.now() + ttlMs;
  const payload = `${role}|${exp}`;
  const sig = await signPayload(payload);
  const q = new URLSearchParams({ role, exp: String(exp), sig });
  const base = `${location.origin}${location.pathname}`.replace(/index\.html$/i, '');
  const url = `${base}#/join?${q.toString()}`;
  return { url, role, exp };
}

/**
 * 解析并应用邀请。成功写入本机角色。
 * 签名：有同步密钥则必须验过；无同步密钥时若过期/角色非法仍拒绝，签名失败则软接受并标注二期加固。
 */
export async function applyInviteFromParams(params) {
  const role = params.get('role') || '';
  const exp = Number(params.get('exp') || 0);
  const sig = params.get('sig') || '';
  if (!isValidRole(role)) throw new Error('邀请链接里的身份无效');
  if (!exp || !Number.isFinite(exp)) throw new Error('邀请链接缺少有效期');
  if (Date.now() > exp) throw new Error('邀请链接已过期，请让爸爸/妈妈重新生成');

  const payload = `${role}|${exp}`;
  const hasSync = !!readSyncKeyLocal();
  const ok = await verifyPayload(payload, sig);
  if (hasSync && !ok) {
    throw new Error('邀请校验失败（可能被篡改，或与本机同步密钥不是同一家）');
  }
  // 无同步密钥：一期仍写入角色并强制 UI 权限；二期应强制验签或改用服务端令牌
  setRole(role);
  return { role, soft: !hasSync || !ok };
}

export function takePendingJoin() {
  // 由 app.js 在启动时调用；这里只提供解析辅助
}

/** 首装 / 无角色：引导选择身份（爸妈优先） */
export function openRolePicker({ force = false, onDone } = {}) {
  if (!force && hasRole()) { if (onDone) onDone(getRole()); return; }
  const adminBtns = ADMIN_ROLES.map((r) => `<button class="btn block role-pick" data-role="${esc(r)}" style="margin-top:8px">${esc(r)}（管理员）</button>`).join('');
  const elderBtns = ELDER_ROLES.map((r) => `<button class="btn secondary block role-pick" data-role="${esc(r)}" style="margin-top:8px">${esc(r)}</button>`).join('');
  openSheet(`
    <h3>选择你的身份</h3>
    <p class="small muted" style="margin-top:0">家有朝朝按身份区分权限。爸爸/妈妈可以改事项、设闹钟、邀请亲友；爷爷奶奶姥姥姥爷可浏览、传相册，不能改日程和危险设置。</p>
    <p class="small" style="margin:8px 0 0"><b>我是爸爸/妈妈</b></p>
    ${adminBtns}
    <p class="small" style="margin:14px 0 0"><b>我是长辈（亲友）</b></p>
    ${elderBtns}
    <p class="note small" style="margin-top:12px">也可等爸爸/妈妈发来邀请链接，打开后自动写入身份。同步密钥请另外向爸妈索取，不会出现在邀请链接里。</p>
  `, (sh) => {
    sh.querySelectorAll('.role-pick').forEach((b) => {
      b.onclick = () => {
        setRole(b.dataset.role);
        closeSheet();
        toast(`已设为「${b.dataset.role}」`);
        window.dispatchEvent(new CustomEvent('rerender'));
        if (location.hash.includes('settings')) window.dispatchEvent(new CustomEvent('hashchange'));
        if (onDone) onDone(b.dataset.role);
      };
    });
  });
}

/** 设置页：生成某角色邀请并复制 */
export async function copyInviteFor(role) {
  const { url, exp } = await createInvite(role);
  const until = new Date(exp);
  const p = (n) => String(n).padStart(2, '0');
  const untilTxt = `${until.getMonth() + 1}月${until.getDate()}日 ${p(until.getHours())}:${p(until.getMinutes())}`;
  try {
    await navigator.clipboard.writeText(url);
    toast(`已复制「${role}」邀请链接（${untilTxt}前有效）`, 4000);
  } catch {
    openSheet(`
      <h3>邀请「${esc(role)}」</h3>
      <p class="small muted">请长按复制下面的链接发给对方（不含同步密钥；密钥请另外告知）。</p>
      <textarea class="input" rows="4" readonly id="invUrl">${esc(url)}</textarea>
      <p class="small muted">${untilTxt} 前有效</p>
      <button class="btn block" id="invClose">关闭</button>
    `, (sh) => {
      sh.querySelector('#invUrl').onclick = (e) => e.target.select();
      sh.querySelector('#invClose').onclick = closeSheet;
    });
  }
  return url;
}
