import { useState, useEffect, useCallback } from "react";
import { ArrowLeft, Server, CheckCircle2, XCircle, RefreshCw, AlertTriangle, Clock, Database } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { API_CONFIG } from "@/config/api";

interface HealthCheckResult {
  endpoint: string;
  status: 'success' | 'error' | 'pending';
  statusCode?: number;
  responseTime?: number;
  message?: string;
  serverVersion?: string;
  hasDeviceRef?: boolean;
  timestamp: string;
}

interface BackendInfo {
  isNewBackend: boolean;
  version?: string;
  hasVersionEndpoint: boolean;
  hasDeviceRefIssue: boolean;
  lastCheck: string;
}

const BackendStatus = () => {
  const navigate = useNavigate();
  const [isChecking, setIsChecking] = useState(false);
  const [healthChecks, setHealthChecks] = useState<HealthCheckResult[]>([]);
  const [backendInfo, setBackendInfo] = useState<BackendInfo | null>(null);
  const [logs, setLogs] = useState<string[]>([]);

  const addLog = useCallback((message: string) => {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${message}`;
    console.log(`🔍 Backend Status: ${message}`);
    setLogs(prev => [logEntry, ...prev].slice(0, 50)); // Keep last 50 logs
  }, []);

  const checkEndpoint = async (
    endpoint: string, 
    description: string
  ): Promise<HealthCheckResult> => {
    const startTime = Date.now();
    const url = `${API_CONFIG.MYSQL_API_URL}${endpoint}`;
    
    addLog(`Probing ${description}: ${url}`);
    
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      
      const response = await fetch(url, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      const responseTime = Date.now() - startTime;
      
      let data: any = null;
      try {
        data = await response.json();
      } catch {
        // Response might not be JSON
      }

      const hasDeviceRef = data?.error?.includes('device_ref') || 
                           JSON.stringify(data).includes('device_ref');
      
      if (hasDeviceRef) {
        addLog(`⚠️ ${description}: OLD BACKEND DETECTED (device_ref error)`);
      }

      const result: HealthCheckResult = {
        endpoint,
        status: response.ok ? 'success' : 'error',
        statusCode: response.status,
        responseTime,
        message: data?.message || data?.error || response.statusText,
        serverVersion: data?.version,
        hasDeviceRef,
        timestamp: new Date().toISOString(),
      };

      addLog(`${response.ok ? '✅' : '❌'} ${description}: ${response.status} (${responseTime}ms)`);
      
      return result;
    } catch (error: any) {
      const responseTime = Date.now() - startTime;
      addLog(`❌ ${description}: ${error.message} (${responseTime}ms)`);
      
      return {
        endpoint,
        status: 'error',
        responseTime,
        message: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  };

  const runHealthChecks = useCallback(async () => {
    setIsChecking(true);
    setHealthChecks([]);
    addLog('=== Starting Backend Health Check ===');
    addLog(`Target: ${API_CONFIG.MYSQL_API_URL}`);

    const results: HealthCheckResult[] = [];

    // Check 1: Version endpoint (new backend indicator)
    const versionCheck = await checkEndpoint('/api/version', 'Version Endpoint');
    results.push(versionCheck);

    // Check 2: Device fingerprint check (will reveal device_ref issue)
    const testFingerprint = 'health_check_probe_' + Date.now();
    const deviceCheck = await checkEndpoint(
      `/api/devices/fingerprint/${testFingerprint}`,
      'Device Lookup'
    );
    results.push(deviceCheck);

    // Check 3: Routes endpoint
    const routesCheck = await checkEndpoint(
      `/api/routes/by-device/${testFingerprint}`,
      'Routes Endpoint'
    );
    results.push(routesCheck);

    // Check 4: Sessions endpoint
    const sessionsCheck = await checkEndpoint(
      `/api/sessions/by-device/${testFingerprint}`,
      'Sessions Endpoint'
    );
    results.push(sessionsCheck);

    setHealthChecks(results);

    // Determine backend status
    const hasVersionEndpoint = versionCheck.status === 'success';
    const hasDeviceRefIssue = results.some(r => r.hasDeviceRef);
    const isNewBackend = hasVersionEndpoint && !hasDeviceRefIssue;
    
    const info: BackendInfo = {
      isNewBackend,
      version: versionCheck.serverVersion,
      hasVersionEndpoint,
      hasDeviceRefIssue,
      lastCheck: new Date().toISOString(),
    };
    
    setBackendInfo(info);

    if (isNewBackend) {
      addLog('✅ NEW BACKEND DETECTED - All systems operational');
    } else if (hasDeviceRefIssue) {
      addLog('⚠️ OLD BACKEND DETECTED - device_ref column issue present');
    } else if (!hasVersionEndpoint) {
      addLog('⚠️ LEGACY BACKEND - Missing /api/version endpoint');
    }

    addLog('=== Health Check Complete ===');
    setIsChecking(false);
  }, [addLog]);

  useEffect(() => {
    runHealthChecks();
  }, []);

  const getStatusBadge = (status: 'success' | 'error' | 'pending') => {
    switch (status) {
      case 'success':
        return <Badge variant="default" className="gap-1 bg-green-600"><CheckCircle2 className="h-3 w-3" />OK</Badge>;
      case 'error':
        return <Badge variant="destructive" className="gap-1"><XCircle className="h-3 w-3" />Error</Badge>;
      case 'pending':
        return <Badge variant="secondary" className="gap-1"><Clock className="h-3 w-3" />Pending</Badge>;
    }
  };

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate("/settings")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex-1">
            <h1 className="text-2xl font-bold">Backend Status</h1>
            <p className="text-sm text-muted-foreground">
              Server: {API_CONFIG.MYSQL_API_URL}
            </p>
          </div>
          <Button 
            onClick={runHealthChecks} 
            disabled={isChecking}
            size="sm"
            className="gap-2"
          >
            <RefreshCw className={`h-4 w-4 ${isChecking ? 'animate-spin' : ''}`} />
            {isChecking ? 'Checking...' : 'Refresh'}
          </Button>
        </div>

        {/* Backend Status Summary */}
        <Card className={backendInfo?.isNewBackend ? 'border-green-500' : backendInfo?.hasDeviceRefIssue ? 'border-destructive' : 'border-yellow-500'}>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Server className="h-5 w-5 text-primary" />
                <div>
                  <CardTitle>Server Instance</CardTitle>
                  <CardDescription>Backend version and compatibility</CardDescription>
                </div>
              </div>
              {backendInfo && (
                backendInfo.isNewBackend ? (
                  <Badge variant="default" className="gap-1 bg-green-600">
                    <CheckCircle2 className="h-3 w-3" />
                    New Backend
                  </Badge>
                ) : backendInfo.hasDeviceRefIssue ? (
                  <Badge variant="destructive" className="gap-1">
                    <AlertTriangle className="h-3 w-3" />
                    Old Backend
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="gap-1">
                    <AlertTriangle className="h-3 w-3" />
                    Legacy
                  </Badge>
                )
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {backendInfo && (
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Version Endpoint:</span>
                  <span className={backendInfo.hasVersionEndpoint ? 'text-green-600 font-medium' : 'text-destructive font-medium'}>
                    {backendInfo.hasVersionEndpoint ? 'Available' : 'Missing (404)'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">device_ref Issue:</span>
                  <span className={!backendInfo.hasDeviceRefIssue ? 'text-green-600 font-medium' : 'text-destructive font-medium'}>
                    {backendInfo.hasDeviceRefIssue ? 'Detected (OLD)' : 'None (OK)'}
                  </span>
                </div>
                {backendInfo.version && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Server Version:</span>
                    <span className="font-medium">{backendInfo.version}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Last Check:</span>
                  <span className="font-mono text-xs">{new Date(backendInfo.lastCheck).toLocaleTimeString()}</span>
                </div>
              </div>
            )}

            {backendInfo?.hasDeviceRefIssue && (
              <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
                <strong>Action Required:</strong> The backend is running an old version that references 
                the <code className="bg-destructive/20 px-1 rounded">device_ref</code> column. 
                Please redeploy <code>backend-api/server.js</code> to the server.
              </div>
            )}

            {backendInfo && !backendInfo.hasVersionEndpoint && !backendInfo.hasDeviceRefIssue && (
              <div className="p-3 rounded-lg bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 text-sm">
                <strong>Note:</strong> The <code>/api/version</code> endpoint is missing. 
                Consider deploying the latest <code>backend-api/server.js</code>.
              </div>
            )}
          </CardContent>
        </Card>

        {/* Endpoint Health Checks */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <Database className="h-5 w-5 text-primary" />
              <div>
                <CardTitle>Endpoint Health</CardTitle>
                <CardDescription>Individual API endpoint status</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {healthChecks.length === 0 && isChecking && (
                <div className="text-center py-4 text-muted-foreground">
                  Checking endpoints...
                </div>
              )}
              {healthChecks.map((check, index) => (
                <div key={index} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                  <div className="flex-1">
                    <div className="font-medium text-sm">{check.endpoint}</div>
                    <div className="text-xs text-muted-foreground">
                      {check.message || 'No message'}
                      {check.hasDeviceRef && (
                        <span className="text-destructive ml-2">[device_ref error]</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {check.responseTime}ms
                    </span>
                    {getStatusBadge(check.status)}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Request Logs */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Request Logs</CardTitle>
            <CardDescription>Detailed probe activity</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="bg-muted/50 rounded-lg p-3 max-h-64 overflow-y-auto">
              <pre className="text-xs font-mono space-y-1">
                {logs.length === 0 ? (
                  <span className="text-muted-foreground">No logs yet...</span>
                ) : (
                  logs.map((log, i) => (
                    <div key={i} className={
                      log.includes('✅') ? 'text-green-600' :
                      log.includes('❌') ? 'text-destructive' :
                      log.includes('⚠️') ? 'text-yellow-600' :
                      'text-foreground'
                    }>
                      {log}
                    </div>
                  ))
                )}
              </pre>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default BackendStatus;
