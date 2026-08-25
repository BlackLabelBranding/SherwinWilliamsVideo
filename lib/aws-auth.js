const crypto = require('crypto');
const {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  ChangePasswordCommand,
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
  AdminDisableUserCommand,
  AdminEnableUserCommand
} = require('@aws-sdk/client-cognito-identity-provider');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');

function isCognitoEnabled() {
  return Boolean(process.env.COGNITO_USER_POOL_ID)
    && Boolean(process.env.COGNITO_CLIENT_ID);
}

function awsRegion() {
  return process.env.AWS_REGION || 'us-east-1';
}

function userPoolId() {
  return process.env.COGNITO_USER_POOL_ID;
}

function cognitoClient() {
  return new CognitoIdentityProviderClient({ region: awsRegion() });
}

function ddbClient() {
  return DynamoDBDocumentClient.from(new DynamoDBClient({ region: awsRegion() }));
}

function usersTableName() {
  return process.env.DDB_USERS_TABLE || 'sw_users';
}

function secretHash(username) {
  const secret = process.env.COGNITO_CLIENT_SECRET;
  const clientId = process.env.COGNITO_CLIENT_ID;
  if (!secret || !clientId) return undefined;
  return crypto
    .createHmac('sha256', secret)
    .update(`${username}${clientId}`)
    .digest('base64');
}

function mapCognitoError(error) {
  const name = error.name || error.__type || '';
  const msg = String(error.message || '');
  const mapped = new Error(msg || 'Authentication failed');
  mapped.status = 400;

  if (name === 'NotAuthorizedException' || name === 'UserNotFoundException') {
    mapped.message = 'Invalid username or password';
    mapped.status = 401;
  } else if (name === 'UserNotConfirmedException') {
    mapped.message = 'This account is not confirmed yet.';
    mapped.status = 403;
  } else if (name === 'PasswordResetRequiredException') {
    mapped.message = 'Password reset is required for this account.';
    mapped.status = 403;
  } else if (name === 'UsernameExistsException') {
    mapped.message = 'Username already exists.';
    mapped.status = 400;
  } else if (name === 'InvalidPasswordException') {
    mapped.message = msg || 'Password does not meet Cognito policy.';
    mapped.status = 400;
  } else if (name === 'InvalidParameterException' && /USER_PASSWORD_AUTH/i.test(msg)) {
    mapped.message = 'Cognito app client must allow USER_PASSWORD_AUTH (ALLOW_USER_PASSWORD_AUTH).';
    mapped.status = 500;
  } else if (name === 'NotAuthorizedException' && /secret/i.test(msg)) {
    mapped.message = 'Cognito client secret is missing or incorrect.';
    mapped.status = 500;
  }
  return mapped;
}

async function getUserProfileByUsername(username) {
  const table = usersTableName();
  const ddb = ddbClient();
  const response = await ddb.send(new GetCommand({
    TableName: table,
    Key: { username }
  }));
  return response.Item || null;
}

async function upsertUserProfile(profile) {
  const table = usersTableName();
  const ddb = ddbClient();
  const existing = profile.username ? await getUserProfileByUsername(profile.username) : null;
  const record = {
    username: profile.username,
    user_id: profile.user_id || existing?.user_id || profile.username,
    display_name: profile.display_name || existing?.display_name || profile.username,
    role: profile.role || existing?.role || 'driver',
    active: profile.active != null ? Boolean(profile.active) : existing?.active !== false,
    employee_id: profile.employee_id ?? existing?.employee_id ?? '',
    must_change_password: profile.must_change_password != null
      ? Boolean(profile.must_change_password)
      : Boolean(existing?.must_change_password),
    last_login_at: profile.last_login_at || existing?.last_login_at || null,
    created_at: existing?.created_at || profile.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  await ddb.send(new PutCommand({ TableName: table, Item: record }));
  return record;
}

async function listUserProfiles() {
  const table = usersTableName();
  const ddb = ddbClient();
  const response = await ddb.send(new ScanCommand({ TableName: table }));
  return (response.Items || []).sort((a, b) => String(a.display_name || '').localeCompare(String(b.display_name || '')));
}

function placeholderEmail(username) {
  const safe = String(username || 'driver').replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 48) || 'driver';
  return `${safe}@drivers.sherwin.local`;
}

async function adminCreateUser({ username, password, displayName, employeeId, role = 'driver', email = '' }) {
  const client = cognitoClient();
  const pool = userPoolId();
  const mail = email || placeholderEmail(username);

  const baseAttrs = [
    { Name: 'name', Value: displayName || username },
    { Name: 'email', Value: mail },
    { Name: 'email_verified', Value: 'true' }
  ];
  const withEmployee = employeeId
    ? [...baseAttrs, { Name: 'custom:employee_id', Value: String(employeeId) }]
    : baseAttrs;

  async function create(attributes) {
    await client.send(new AdminCreateUserCommand({
      UserPoolId: pool,
      Username: username,
      TemporaryPassword: password,
      MessageAction: 'SUPPRESS',
      UserAttributes: attributes
    }));
  }

  try {
    try {
      await create(withEmployee);
    } catch (error) {
      if (error.name === 'InvalidParameterException' && /employee_id|custom:/i.test(error.message || '')) {
        await create(baseAttrs);
      } else if (error.name !== 'UsernameExistsException') {
        throw error;
      }
    }

    await client.send(new AdminSetUserPasswordCommand({
      UserPoolId: pool,
      Username: username,
      Password: password,
      Permanent: true
    }));
  } catch (error) {
    throw mapCognitoError(error);
  }

  return upsertUserProfile({
    username,
    user_id: username,
    display_name: displayName || username,
    role,
    employee_id: employeeId || '',
    active: true,
    must_change_password: true
  });
}

async function adminResetPassword(username, password) {
  try {
    await cognitoClient().send(new AdminSetUserPasswordCommand({
      UserPoolId: userPoolId(),
      Username: username,
      Password: password,
      Permanent: true
    }));
  } catch (error) {
    throw mapCognitoError(error);
  }
  const profile = await getUserProfileByUsername(username) || { username };
  return upsertUserProfile({ ...profile, username, must_change_password: true, active: profile.active !== false });
}

async function setUserActive(username, active) {
  try {
    if (active) {
      await cognitoClient().send(new AdminEnableUserCommand({
        UserPoolId: userPoolId(),
        Username: username
      }));
    } else {
      await cognitoClient().send(new AdminDisableUserCommand({
        UserPoolId: userPoolId(),
        Username: username
      }));
    }
  } catch (error) {
    throw mapCognitoError(error);
  }
  const profile = await getUserProfileByUsername(username) || { username };
  return upsertUserProfile({ ...profile, username, active: Boolean(active) });
}

async function signIn({ username, password }) {
  const client = cognitoClient();
  const hash = secretHash(username);
  const authParameters = {
    USERNAME: username,
    PASSWORD: password
  };
  if (hash) authParameters.SECRET_HASH = hash;

  let auth;
  try {
    auth = await client.send(new InitiateAuthCommand({
      ClientId: process.env.COGNITO_CLIENT_ID,
      AuthFlow: 'USER_PASSWORD_AUTH',
      AuthParameters: authParameters
    }));
  } catch (error) {
    throw mapCognitoError(error);
  }

  if (!auth.AuthenticationResult?.AccessToken) {
    const error = new Error('Authentication challenge is required for this user. Use a permanent password or complete NEW_PASSWORD_REQUIRED in Cognito.');
    error.status = 400;
    throw error;
  }

  let profile = await getUserProfileByUsername(username);
  if (!profile) {
    profile = await upsertUserProfile({
      username,
      user_id: username,
      display_name: username,
      role: username === 'admin' ? 'admin' : 'driver',
      active: true
    });
  }
  if (!profile.active) {
    const error = new Error('Account is disabled.');
    error.status = 403;
    throw error;
  }

  profile = await upsertUserProfile({
    ...profile,
    last_login_at: new Date().toISOString()
  });

  return {
    ok: true,
    accessToken: auth.AuthenticationResult.AccessToken,
    idToken: auth.AuthenticationResult.IdToken || null,
    refreshToken: auth.AuthenticationResult.RefreshToken || null,
    profile
  };
}

async function changeOwnPassword({ username, currentPassword, newPassword }) {
  const signed = await signIn({ username, password: currentPassword });
  try {
    await cognitoClient().send(new ChangePasswordCommand({
      AccessToken: signed.accessToken,
      PreviousPassword: currentPassword,
      ProposedPassword: newPassword
    }));
  } catch (error) {
    throw mapCognitoError(error);
  }
  const profile = await getUserProfileByUsername(username) || { username };
  return upsertUserProfile({ ...profile, username, must_change_password: false });
}

module.exports = {
  isCognitoEnabled,
  signIn,
  changeOwnPassword,
  adminCreateUser,
  adminResetPassword,
  setUserActive,
  getUserProfileByUsername,
  upsertUserProfile,
  listUserProfiles
};
