const crypto = require('crypto');
const {
  CognitoIdentityProviderClient,
  SignUpCommand,
  ConfirmSignUpCommand,
  InitiateAuthCommand,
  ChangePasswordCommand
} = require('@aws-sdk/client-cognito-identity-provider');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');

/** Cognito is usable when pool + app client are configured (AUTH_MODE can be cognito or both). */
function isCognitoEnabled() {
  return Boolean(process.env.COGNITO_USER_POOL_ID)
    && Boolean(process.env.COGNITO_CLIENT_ID);
}

function awsRegion() {
  return process.env.AWS_REGION || 'us-east-1';
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
  const record = {
    username: profile.username,
    user_id: profile.user_id || profile.username,
    display_name: profile.display_name || profile.username,
    role: profile.role || 'driver',
    active: profile.active !== false,
    employee_id: profile.employee_id || '',
    created_at: profile.created_at || new Date().toISOString(),
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

async function signUp({ username, password, displayName, employeeId, role = 'driver', email = '' }) {
  const client = cognitoClient();
  const hash = secretHash(username);
  const attributes = [{ Name: 'name', Value: displayName || username }];
  if (email) attributes.push({ Name: 'email', Value: email });
  if (employeeId) attributes.push({ Name: 'custom:employee_id', Value: String(employeeId) });

  await client.send(new SignUpCommand({
    ClientId: process.env.COGNITO_CLIENT_ID,
    Username: username,
    Password: password,
    SecretHash: hash,
    UserAttributes: attributes
  }));

  const profile = await upsertUserProfile({
    username,
    user_id: username,
    display_name: displayName || username,
    role,
    employee_id: employeeId || '',
    active: true
  });
  return { ok: true, requires_confirmation: true, user: profile };
}

async function confirmSignUp({ username, code }) {
  const client = cognitoClient();
  const hash = secretHash(username);
  await client.send(new ConfirmSignUpCommand({
    ClientId: process.env.COGNITO_CLIENT_ID,
    Username: username,
    ConfirmationCode: code,
    SecretHash: hash
  }));
  return { ok: true };
}

async function signIn({ username, password }) {
  const client = cognitoClient();
  const hash = secretHash(username);
  const authParameters = {
    USERNAME: username,
    PASSWORD: password
  };
  if (hash) authParameters.SECRET_HASH = hash;

  const auth = await client.send(new InitiateAuthCommand({
    ClientId: process.env.COGNITO_CLIENT_ID,
    AuthFlow: 'USER_PASSWORD_AUTH',
    AuthParameters: authParameters
  }));

  if (!auth.AuthenticationResult?.AccessToken) {
    const error = new Error('Authentication challenge is required for this user.');
    error.status = 400;
    throw error;
  }

  let profile = await getUserProfileByUsername(username);
  if (!profile) {
    profile = await upsertUserProfile({
      username,
      user_id: username,
      display_name: username,
      role: 'driver',
      active: true
    });
  }
  if (!profile.active) {
    const error = new Error('Account is disabled.');
    error.status = 403;
    throw error;
  }

  return {
    ok: true,
    accessToken: auth.AuthenticationResult.AccessToken,
    idToken: auth.AuthenticationResult.IdToken || null,
    refreshToken: auth.AuthenticationResult.RefreshToken || null,
    profile
  };
}

async function changePassword({ accessToken, currentPassword, newPassword }) {
  const client = cognitoClient();
  await client.send(new ChangePasswordCommand({
    AccessToken: accessToken,
    PreviousPassword: currentPassword,
    ProposedPassword: newPassword
  }));
  return { ok: true };
}

module.exports = {
  isCognitoEnabled,
  signUp,
  confirmSignUp,
  signIn,
  changePassword,
  getUserProfileByUsername,
  upsertUserProfile,
  listUserProfiles
};
