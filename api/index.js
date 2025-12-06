// Mini Test - Backend API
// Tập trung: verify-session, create-project, uploadUserImage, batchGenerateImages

const API_KEY = "AIzaSyBtrm0o5ab1c-Ec8ZuLcGt3oJAA5VWt3pY";
const SANDBOX_URL = "https://aisandbox-pa.googleapis.com/v1";
const LABS_URL = "https://labs.google";
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// Helper: Parse JSON body
async function parseBody(req) {
    return new Promise((resolve) => {
        let data = '';
        req.on('data', chunk => data += chunk);
        req.on('end', () => {
            try { resolve(JSON.parse(data)); }
            catch { resolve({}); }
        });
    });
}

// Helper: CORS headers
function setCors(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

// ============================================
// ENDPOINT 1: Verify Session (Cookie → Token)
// ============================================
async function handleVerifySession(req, res, body) {
    const { cookie } = body;
    if (!cookie) {
        return res.status(400).json({ error: 'Cookie is required' });
    }

    try {
        console.log('[verify-session] Starting...');
        
        // Step 1: Get session info
        const sessionRes = await fetch(`${LABS_URL}/fx/api/auth/session`, {
            headers: {
                'Cookie': cookie,
                'User-Agent': USER_AGENT,
                'Referer': `${LABS_URL}/fx/tools/image-fx`,
            }
        });

        if (!sessionRes.ok) {
            console.log('[verify-session] Session failed:', sessionRes.status);
            throw new Error(`Session request failed: ${sessionRes.status}`);
        }

        const sessionData = await sessionRes.json();
        console.log('[verify-session] Session data:', JSON.stringify(sessionData).substring(0, 200));

        if (!sessionData?.user?.email) {
            throw new Error('Invalid session - no user email');
        }

        // Step 2: Get access token from signin callback
        const tokenRes = await fetch(`${LABS_URL}/fx/api/auth/callback/google?silentRefresh=true`, {
            headers: {
                'Cookie': cookie,
                'User-Agent': USER_AGENT,
                'Referer': `${LABS_URL}/fx/tools/image-fx`,
            },
            redirect: 'manual'
        });

        // Token might be in redirect or we need another approach
        // Try getting token from a different endpoint
        const csrfRes = await fetch(`${LABS_URL}/fx/api/auth/csrf`, {
            headers: {
                'Cookie': cookie,
                'User-Agent': USER_AGENT,
            }
        });
        const csrfData = await csrfRes.json();
        console.log('[verify-session] CSRF:', csrfData);

        // Try the trpc endpoint to get token
        const trpcRes = await fetch(`${LABS_URL}/fx/api/trpc/users.getSelf?batch=1&input={}`, {
            headers: {
                'Cookie': cookie,
                'User-Agent': USER_AGENT,
                'Content-Type': 'application/json',
                'Referer': `${LABS_URL}/fx/tools/image-fx`,
            }
        });

        let accessToken = null;

        // Try to extract token from internal API
        const internalRes = await fetch(`${LABS_URL}/fx/api/trpc/accessTokens.getOrCreate?batch=1`, {
            method: 'POST',
            headers: {
                'Cookie': cookie,
                'User-Agent': USER_AGENT,
                'Content-Type': 'application/json',
                'Referer': `${LABS_URL}/fx/tools/image-fx`,
            },
            body: JSON.stringify({ "0": { "json": null } })
        });

        if (internalRes.ok) {
            const tokenData = await internalRes.json();
            console.log('[verify-session] Token response:', JSON.stringify(tokenData).substring(0, 300));
            accessToken = tokenData?.[0]?.result?.data?.json?.accessToken || 
                         tokenData?.[0]?.result?.data?.accessToken ||
                         tokenData?.result?.data?.json?.accessToken;
        }

        if (!accessToken) {
            // Fallback: try different endpoint structure
            const altRes = await fetch(`${LABS_URL}/fx/api/trpc/accessTokens.getOrCreate`, {
                method: 'POST',
                headers: {
                    'Cookie': cookie,
                    'User-Agent': USER_AGENT,
                    'Content-Type': 'application/json',
                    'Referer': `${LABS_URL}/fx/tools/image-fx`,
                },
                body: JSON.stringify({ "json": null })
            });

            if (altRes.ok) {
                const altData = await altRes.json();
                console.log('[verify-session] Alt token response:', JSON.stringify(altData).substring(0, 300));
                accessToken = altData?.result?.data?.json?.accessToken ||
                             altData?.result?.data?.accessToken ||
                             altData?.accessToken;
            }
        }

        res.status(200).json({
            success: true,
            sessionData: sessionData,
            accessToken: accessToken,
            message: accessToken ? 'Full authentication successful' : 'Session valid but token extraction needs manual input'
        });

    } catch (error) {
        console.error('[verify-session] Error:', error.message);
        res.status(500).json({ error: error.message });
    }
}

// ============================================
// ENDPOINT 2: Create Project
// ============================================
async function handleCreateProject(req, res, body) {
    const { cookie, projectName } = body;
    if (!cookie) {
        return res.status(400).json({ error: 'Cookie is required' });
    }

    try {
        console.log('[create-project] Creating:', projectName);

        const response = await fetch(`${LABS_URL}/fx/api/trpc/projects.upsert?batch=1`, {
            method: 'POST',
            headers: {
                'Cookie': cookie,
                'User-Agent': USER_AGENT,
                'Content-Type': 'application/json',
                'Referer': `${LABS_URL}/fx/tools/image-fx`,
            },
            body: JSON.stringify({
                "0": {
                    "json": {
                        "title": projectName || `Project_${Date.now()}`,
                        "tool": "IMAGE_FX"
                    }
                }
            })
        });

        const data = await response.json();
        console.log('[create-project] Response:', JSON.stringify(data).substring(0, 500));

        if (!response.ok) {
            throw new Error(data?.error?.message || `Create project failed: ${response.status}`);
        }

        // Extract project ID from response
        const projectId = data?.[0]?.result?.data?.json?.id ||
                         data?.[0]?.result?.data?.id ||
                         data?.result?.data?.json?.id ||
                         data?.result?.data?.id;

        if (!projectId) {
            throw new Error('Could not extract project ID from response');
        }

        res.status(200).json({
            success: true,
            projectId: projectId
        });

    } catch (error) {
        console.error('[create-project] Error:', error.message);
        res.status(500).json({ error: error.message });
    }
}

// ============================================
// ENDPOINT 3: Upload Reference Image
// ============================================
async function handleUploadImage(req, res, body) {
    const { bearerToken, payload } = body;
    
    if (!bearerToken || !payload) {
        console.log('[uploadImage] Missing params:', { hasBearerToken: !!bearerToken, hasPayload: !!payload });
        return res.status(400).json({ error: 'bearerToken and payload are required' });
    }

    try {
        console.log('[uploadImage] Starting upload...');
        console.log('[uploadImage] Token:', bearerToken.substring(0, 30) + '...');
        console.log('[uploadImage] Payload keys:', Object.keys(payload));
        console.log('[uploadImage] ImageInput:', {
            hasMimeType: !!payload?.imageInput?.mimeType,
            hasRawBytes: !!payload?.imageInput?.rawImageBytes,
            bytesLength: payload?.imageInput?.rawImageBytes?.length,
            aspectRatio: payload?.imageInput?.aspectRatio
        });

        const url = `${SANDBOX_URL}:uploadUserImage?key=${API_KEY}`;
        console.log('[uploadImage] URL:', url);
        
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${bearerToken}`,
                'Content-Type': 'text/plain;charset=UTF-8',
                'Referer': `${LABS_URL}/`,
                'User-Agent': USER_AGENT,
            },
            body: JSON.stringify(payload)
        });

        const text = await response.text();
        console.log('[uploadImage] Status:', response.status);
        console.log('[uploadImage] Response:', text.substring(0, 1000));

        let data;
        try {
            data = JSON.parse(text);
        } catch (e) {
            console.error('[uploadImage] JSON parse error:', e.message);
            throw new Error(`Invalid JSON response: ${text.substring(0, 200)}`);
        }

        if (!response.ok) {
            console.error('[uploadImage] HTTP error:', response.status, data);
            throw new Error(data?.error?.message || `Upload failed: ${response.status} - ${text.substring(0, 200)}`);
        }

        // Extract media ID from multiple possible locations
        const mediaId = data?.mediaGenerationId?.mediaGenerationId || 
                       data?.name || 
                       data?.imageId ||
                       data?.id;

        console.log('[uploadImage] Extracted mediaId:', mediaId);

        res.status(200).json({
            success: !!mediaId,
            mediaId: mediaId,
            raw: data
        });

    } catch (error) {
        console.error('[uploadImage] Error:', error.message);
        res.status(500).json({ error: error.message });
    }
}

// ============================================
// ENDPOINT 4: Batch Generate Images
// ============================================
async function handleGenerateImages(req, res, body) {
    const { bearerToken, projectId, payload } = body;

    if (!bearerToken || !projectId || !payload) {
        return res.status(400).json({ error: 'bearerToken, projectId and payload are required' });
    }

    try {
        console.log('[generate] Starting generation...');

        const url = `${SANDBOX_URL}/projects/${projectId}/flowMedia:batchGenerateImages`;

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${bearerToken}`,
                'Content-Type': 'text/plain;charset=UTF-8',
                'Referer': `${LABS_URL}/`,
                'User-Agent': USER_AGENT,
                'x-browser-channel': 'stable',
                'x-browser-copyright': 'Copyright 2025 Google LLC. All rights reserved.',
                'x-browser-year': '2025',
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json();
        console.log('[generate] Response:', JSON.stringify(data).substring(0, 1000));

        if (!response.ok) {
            throw new Error(data?.error?.message || `Generate failed: ${response.status}`);
        }

        res.status(200).json(data);

    } catch (error) {
        console.error('[generate] Error:', error.message);
        res.status(500).json({ error: error.message });
    }
}

// ============================================
// MAIN HANDLER
// ============================================
module.exports = async function handler(req, res) {
    setCors(res);

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const path = req.url.split('?')[0];
    console.log(`[${new Date().toISOString()}] ${req.method} ${path}`);

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const body = await parseBody(req);

    try {
        if (path === '/api/proxy/verify-session') {
            return await handleVerifySession(req, res, body);
        }
        if (path === '/api/proxy/create-project') {
            return await handleCreateProject(req, res, body);
        }
        if (path === '/api/proxy/uploadUserImage') {
            return await handleUploadImage(req, res, body);
        }
        if (path === '/api/proxy/batchGenerateImages') {
            return await handleGenerateImages(req, res, body);
        }

        return res.status(404).json({ error: `Unknown endpoint: ${path}` });

    } catch (error) {
        console.error('[handler] Unhandled error:', error);
        return res.status(500).json({ error: error.message });
    }
};
