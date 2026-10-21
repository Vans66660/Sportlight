const cloud = require('wx-server-sdk')
const crypto = require('crypto')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const DEPARTMENTS = ['市场部', '数据部', '研发部', '宣发部']
const SESSION_DAYS = 30
const CORS_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type,authorization'
}

function respond(statusCode, body) {
  return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(body) }
}

function hash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex')
}

function makeId(prefix) {
  return `${prefix}_${crypto.randomBytes(12).toString('hex')}`
}

function readRequest(event) {
  let body = event.body || {}
  if (typeof body === 'string') {
    try { body = JSON.parse(body || '{}') } catch (e) { body = {} }
  }
  return { ...(event.queryStringParameters || {}), ...(body || {}) }
}

function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase()
}

function normalizeDepartments(value) {
  const list = Array.isArray(value) ? value : []
  return [...new Set(list.filter(item => DEPARTMENTS.includes(item)))]
}

function safeMember(member) {
  if (!member) return null
  return {
    id: member._id,
    username: member.username,
    name: member.name,
    departments: member.departments || [],
    role: member.role || 'member',
    status: member.status || 'active',
    createdAt: member.createdAt || null
  }
}

function passwordHash(password, salt) {
  return crypto.scryptSync(String(password), salt, 64).toString('hex')
}

function samePassword(password, member) {
  const actual = Buffer.from(passwordHash(password, member.passwordSalt), 'hex')
  const expected = Buffer.from(member.passwordHash, 'hex')
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected)
}

function tokenFrom(event) {
  const headers = event.headers || {}
  const auth = headers.authorization || headers.Authorization || ''
  return String(auth).replace(/^Bearer\s+/i, '').trim()
}

async function createSession(member) {
  const token = crypto.randomBytes(32).toString('base64url')
  const now = Date.now()
  await db.collection('internalSessions').add({
    data: {
      tokenHash: hash(token),
      memberId: member._id,
      expiresAt: now + SESSION_DAYS * 24 * 60 * 60 * 1000,
      revoked: false,
      createdAt: db.serverDate(),
      updatedAt: db.serverDate()
    }
  })
  return token
}

async function getActor(event) {
  const token = tokenFrom(event)
  if (!token) throw Object.assign(new Error('请先登录'), { statusCode: 401 })
  const sessionRes = await db.collection('internalSessions')
    .where({ tokenHash: hash(token), revoked: false })
    .limit(1)
    .get()
  const session = (sessionRes.data || [])[0]
  if (!session || Number(session.expiresAt || 0) < Date.now()) {
    throw Object.assign(new Error('登录已过期，请重新登录'), { statusCode: 401 })
  }
  const memberRes = await db.collection('internalMembers').doc(session.memberId).get()
  const member = memberRes.data
  if (!member || member.status !== 'active') {
    throw Object.assign(new Error('账号不可用'), { statusCode: 403 })
  }
  return member
}

function requireAdmin(member) {
  if (member.role !== 'admin') throw Object.assign(new Error('仅管理员可执行此操作'), { statusCode: 403 })
}

function canAccessProject(member, project) {
  if (project.ownerId === member._id || member.role === 'admin') return true
  const departments = member.departments || []
  if (project.type === 'internal') return (project.ownerDepartments || []).some(item => departments.includes(item))
  return (project.collaboratorDepartments || []).some(item => departments.includes(item))
}

async function register(input) {
  const username = normalizeUsername(input.username)
  const name = String(input.name || '').trim()
  const password = String(input.password || '')
  if (!/^[a-z0-9._-]{3,32}$/.test(username)) throw Object.assign(new Error('账号需为 3-32 位英文、数字或 ._-'), { statusCode: 400 })
  if (!name || name.length > 30) throw Object.assign(new Error('请填写姓名'), { statusCode: 400 })
  if (password.length < 8) throw Object.assign(new Error('密码至少 8 位'), { statusCode: 400 })
  const id = `member_${hash(username).slice(0, 40)}`
  const existing = await db.collection('internalMembers').doc(id).get().catch(() => null)
  if (existing && existing.data) throw Object.assign(new Error('该账号已注册'), { statusCode: 409 })

  const salt = crypto.randomBytes(16).toString('hex')
  const adminUsername = normalizeUsername(process.env.INTERNAL_WORKBENCH_ADMIN_USERNAME)
  const member = {
    _id: id,
    username,
    name,
    passwordSalt: salt,
    passwordHash: passwordHash(password, salt),
    departments: [],
    role: adminUsername && username === adminUsername ? 'admin' : 'member',
    status: 'active',
    createdAt: db.serverDate(),
    updatedAt: db.serverDate()
  }
  try {
    await db.collection('internalMembers').doc(id).set({ data: member })
  } catch (error) {
    if (/exist|duplicate/i.test(error.message || '')) throw Object.assign(new Error('该账号已注册'), { statusCode: 409 })
    throw error
  }
  const token = await createSession(member)
  return { token, member: safeMember(member) }
}

async function login(input) {
  const username = normalizeUsername(input.username)
  const id = `member_${hash(username).slice(0, 40)}`
  const result = await db.collection('internalMembers').doc(id).get().catch(() => null)
  const member = result && result.data
  if (!member || !samePassword(input.password || '', member)) throw Object.assign(new Error('账号或密码错误'), { statusCode: 401 })
  if (member.status !== 'active') throw Object.assign(new Error('账号不可用'), { statusCode: 403 })
  const token = await createSession(member)
  return { token, member: safeMember(member) }
}

async function listMembers() {
  const res = await db.collection('internalMembers').orderBy('createdAt', 'desc').limit(100).get()
  return (res.data || []).map(safeMember)
}

async function updateMemberDepartments(actor, input) {
  requireAdmin(actor)
  const departments = normalizeDepartments(input.departments)
  if (!departments.length) throw Object.assign(new Error('成员至少需要归属一个部门'), { statusCode: 400 })
  await db.collection('internalMembers').doc(input.memberId).update({ data: { departments, updatedAt: db.serverDate() } })
  return { memberId: input.memberId, departments }
}

async function listProjects(actor) {
  const res = await db.collection('internalProjects').orderBy('updatedAt', 'desc').limit(100).get()
  return (res.data || []).filter(project => canAccessProject(actor, project))
}

async function createProject(actor, input) {
  const type = input.type === 'collaboration' ? 'collaboration' : 'internal'
  const title = String(input.title || '').trim()
  const parts = Array.isArray(input.parts) ? input.parts.map(item => String(item || '').trim()).filter(Boolean) : []
  const collaboratorDepartments = type === 'collaboration' ? normalizeDepartments(input.collaboratorDepartments) : []
  if (!title) throw Object.assign(new Error('请填写项目名称'), { statusCode: 400 })
  if (!actor.departments.length) throw Object.assign(new Error('请先联系管理员分配所属部门'), { statusCode: 400 })
  if (type === 'collaboration' && !collaboratorDepartments.length) throw Object.assign(new Error('请选择协作部门'), { statusCode: 400 })
  if (!parts.length) throw Object.assign(new Error('请至少设置一个项目部分'), { statusCode: 400 })
  const project = {
    title,
    type,
    ownerId: actor._id,
    ownerName: actor.name,
    ownerDepartments: actor.departments,
    collaboratorDepartments,
    deadline: String(input.deadline || ''),
    requirements: String(input.requirements || ''),
    submissionMode: input.submissionMode || 'step',
    attachments: Array.isArray(input.attachments) ? input.attachments : [],
    parts: parts.map((title, index) => ({ id: makeId(`part${index + 1}`), title, status: 'open', assigneeId: '', assigneeName: '', submissions: [] })),
    status: 'open',
    createdAt: db.serverDate(),
    updatedAt: db.serverDate()
  }
  const result = await db.collection('internalProjects').add({ data: project })
  return { id: result._id, ...project }
}

async function claimProjectPart(actor, input) {
  return db.runTransaction(async transaction => {
    const projectRes = await transaction.collection('internalProjects').doc(input.projectId).get()
    const project = projectRes.data
    if (!project) throw Object.assign(new Error('未找到项目'), { statusCode: 404 })
    if (!canAccessProject(actor, project)) throw Object.assign(new Error('无权领取该项目部分'), { statusCode: 403 })
    const parts = project.parts || []
    const part = parts.find(item => item.id === input.partId)
    if (!part) throw Object.assign(new Error('未找到项目部分'), { statusCode: 404 })
    if (part.assigneeId && part.assigneeId !== actor._id) throw Object.assign(new Error('该部分已被其他成员领取'), { statusCode: 409 })
    part.assigneeId = actor._id
    part.assigneeName = actor.name
    part.status = 'in_progress'
    await transaction.collection('internalProjects').doc(project._id).update({ data: { parts, updatedAt: db.serverDate() } })
    return { ...project, parts }
  })
}

async function submitProjectPart(actor, input) {
  const projectRes = await db.collection('internalProjects').doc(input.projectId).get()
  const project = projectRes.data
  const parts = project.parts || []
  const part = parts.find(item => item.id === input.partId)
  if (!part) throw Object.assign(new Error('未找到项目部分'), { statusCode: 404 })
  if (part.assigneeId !== actor._id && actor.role !== 'admin') throw Object.assign(new Error('只能提交自己领取的部分'), { statusCode: 403 })
  part.status = 'submitted'
  part.submissions = [...(part.submissions || []), {
    id: makeId('submission'),
    note: String(input.note || ''),
    attachments: Array.isArray(input.attachments) ? input.attachments : [],
    submittedBy: actor._id,
    submittedByName: actor.name,
    submittedAt: Date.now()
  }]
  await db.collection('internalProjects').doc(project._id).update({ data: { parts, updatedAt: db.serverDate() } })
  return project
}

async function listFolders() {
  const res = await db.collection('internalFolders').orderBy('createdAt', 'asc').limit(100).get()
  return res.data || []
}

async function createFolder(actor, input) {
  const name = String(input.name || '').trim()
  if (!name || name.length > 24) throw Object.assign(new Error('文件夹名称需为 1-24 个字符'), { statusCode: 400 })
  const existing = await db.collection('internalFolders').where({ name }).limit(1).get()
  if ((existing.data || []).length) throw Object.assign(new Error('已存在同名文件夹'), { statusCode: 409 })
  const data = { name, creatorId: actor._id, creatorName: actor.name, createdAt: db.serverDate(), updatedAt: db.serverDate() }
  const result = await db.collection('internalFolders').add({ data })
  return { id: result._id, ...data }
}

async function listArchives() {
  const res = await db.collection('internalArchives').orderBy('updatedAt', 'desc').limit(100).get()
  return res.data || []
}

async function createArchive(actor, input) {
  const title = String(input.title || '').trim()
  if (!title) throw Object.assign(new Error('请填写档案名称'), { statusCode: 400 })
  const data = {
    title,
    type: ['profile', 'data', 'material'].includes(input.type) ? input.type : 'material',
    folderId: input.folderId || '',
    department: DEPARTMENTS.includes(input.department) ? input.department : '',
    description: String(input.description || ''),
    attachments: Array.isArray(input.attachments) ? input.attachments : [],
    creatorId: actor._id,
    creatorName: actor.name,
    createdAt: db.serverDate(),
    updatedAt: db.serverDate()
  }
  const result = await db.collection('internalArchives').add({ data })
  return { id: result._id, ...data }
}

async function moveArchive(actor, input) {
  const folderId = input.folderId || ''
  if (folderId) await db.collection('internalFolders').doc(folderId).get()
  await db.collection('internalArchives').doc(input.archiveId).update({ data: { folderId, updatedAt: db.serverDate(), movedBy: actor._id } })
  return { archiveId: input.archiveId, folderId }
}

async function uploadFile(actor, input) {
  const base64 = String(input.base64 || '').replace(/^data:[^;]+;base64,/, '')
  const buffer = Buffer.from(base64, 'base64')
  if (!buffer.length || buffer.length > 5 * 1024 * 1024) throw Object.assign(new Error('单个文件需小于 5MB'), { statusCode: 400 })
  const fileName = String(input.fileName || 'attachment').replace(/[^a-zA-Z0-9._-]/g, '_')
  const cloudPath = `internal-workbench/${actor._id}/${Date.now()}_${fileName}`
  const result = await cloud.uploadFile({ cloudPath, fileContent: buffer })
  return { fileID: result.fileID, name: input.fileName || fileName, size: buffer.length }
}

async function listMessages(actor, input) {
  const department = DEPARTMENTS.includes(input.department) ? input.department : actor.departments[0]
  if (!department || !actor.departments.includes(department) && actor.role !== 'admin') throw Object.assign(new Error('无权查看该部门消息'), { statusCode: 403 })
  const res = await db.collection('internalMessages').where({ department }).orderBy('createdAt', 'asc').limit(100).get()
  return res.data || []
}

async function sendMessage(actor, input) {
  const department = String(input.department || '')
  const content = String(input.content || '').trim()
  if (!DEPARTMENTS.includes(department) || !actor.departments.includes(department) && actor.role !== 'admin') throw Object.assign(new Error('无权向该部门发送消息'), { statusCode: 403 })
  if (!content) throw Object.assign(new Error('消息不能为空'), { statusCode: 400 })
  const data = { department, content, attachments: Array.isArray(input.attachments) ? input.attachments : [], senderId: actor._id, senderName: actor.name, createdAt: db.serverDate() }
  const result = await db.collection('internalMessages').add({ data })
  return { id: result._id, ...data }
}

async function listSchedules(actor) {
  const res = await db.collection('internalSchedules').orderBy('startAt', 'asc').limit(100).get()
  return (res.data || []).filter(item => !item.departments || !item.departments.length || item.departments.some(department => actor.departments.includes(department)) || actor.role === 'admin')
}

async function createSchedule(actor, input) {
  const title = String(input.title || '').trim()
  if (!title || !input.startAt) throw Object.assign(new Error('请填写日程名称和时间'), { statusCode: 400 })
  const data = { title, startAt: String(input.startAt), departments: normalizeDepartments(input.departments), creatorId: actor._id, creatorName: actor.name, createdAt: db.serverDate() }
  const result = await db.collection('internalSchedules').add({ data })
  return { id: result._id, ...data }
}

const actions = {
  register: async input => register(input),
  login: async input => login(input),
  me: async (input, actor) => safeMember(actor),
  logout: async (input, actor, event) => {
    const token = tokenFrom(event)
    await db.collection('internalSessions').where({ tokenHash: hash(token) }).update({ data: { revoked: true, updatedAt: db.serverDate() } })
    return { ok: true }
  },
  listMembers: async (input, actor) => { requireAdmin(actor); return listMembers() },
  updateMemberDepartments,
  listProjects: async (input, actor) => listProjects(actor),
  createProject,
  claimProjectPart,
  submitProjectPart,
  listFolders: async () => listFolders(),
  createFolder,
  listArchives: async () => listArchives(),
  createArchive,
  moveArchive,
  uploadFile,
  listMessages,
  sendMessage,
  listSchedules,
  createSchedule
}

exports.main = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(204, {})
  const input = readRequest(event)
  const action = String(input.action || '')
  if (!actions[action]) return respond(404, { ok: false, message: '未知操作' })
  try {
    const publicActions = ['register', 'login']
    const actor = publicActions.includes(action) ? null : await getActor(event)
    const data = await actions[action](input, actor, event)
    return respond(200, { ok: true, data })
  } catch (error) {
    console.error('[internalWorkbench]', action, error)
    return respond(error.statusCode || 500, { ok: false, message: error.message || '服务器异常' })
  }
}
