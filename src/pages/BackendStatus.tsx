import { useState, useEffect, useCallback } from "react";
import { 
  ArrowLeft, Server, CheckCircle2, XCircle, RefreshCw, AlertTriangle, 
  Clock, Database, Wifi, WifiOff, Activity, HardDrive, Cpu, 
  Globe, Shield, Zap, Timer, BarChart3, Info
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { API_CONFIG } from "@/config/api";
import { generateDeviceFingerprint } from "@/utils/deviceFingerprint";

interface HealthCheckResult {
  endpoint: string;
  name: string;
  status: 'success' | 'error' | 'pending' | 'warning';
  statusCode?: number;
  responseTime?: number;
  message?: string;
  serverVersion?: string;
  hasDeviceRef?: boolean;
  timestamp: string;
  headers?: Record<string, string>;
  responseSize?: number;
}

interface BackendInfo {
  isNewBackend: boolean;
  version?: string;
  nodeVersion?: string;
  hasVersionEndpoint: boolean;
  hasDeviceRefIssue: boolean;
  lastCheck: string;
  averageResponseTime: number;
  totalEndpoints: number;
  healthyEndpoints: number;
}

interface DeviceInfo {
  fingerprint: string;
  isRegistered: boolean;
  isApproved: boolean;
  isAuthorized: boolean;
  devcode?: string;
  routeCount?: number;
  sessionCount?: number;
}

interface ConnectionStats {
  latency: number;
  jitter: number;
  packetLoss: number;
  connectionType: string;
  effectiveType: string;
  downlink: number;
}

const BackendStatus = () => {
  const navigate = useNavigate();
  const [isChecking, setIsChecking] = useState(false);
  const [healthChecks, setHealthChecks] = useState<HealthCheckResult[]>([]);
  const [backendInfo, setBackendInfo] = useState<BackendInfo | null>(null);
  const [deviceInfo, setDeviceInfo] = useState<DeviceInfo | null>(null);
  const [connectionStats, setConnectionStats] = useState<ConnectionStats | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [checkProgress, setCheckProgress] = useState(0);

  const addLog = useCallback((message: string) => {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${message}`;
    console.log(`🔍 Backend Status: ${message}`);
    setLogs(prev => [logEntry, ...prev].slice(0, 100));
  }, []);

  // Get connection stats from Network Information API
  const getConnectionStats = useCallback((): ConnectionStats => {
    const connection = (navigator as any).connection || 
                       (navigator as any).mozConnection || 
                       (navigator as any).webkitConnection;
    
    return {
      latency: 0,
      jitter: 0,
      packetLoss: 0,
      connectionType: connection?.type || 'unknown',
      effectiveType: connection?.effectiveType || 'unknown',
      downlink: connection?.downlink || 0,
    };
  }, []);

  const checkEndpoint = async (
    endpoint: string, 
    name: string,
    expectedStatus?: number[]
  ): Promise<HealthCheckResult> => {
    const startTime = Date.now();
    const url = `${API_CONFIG.MYSQL_API_URL}${endpoint}`;
    
    addLog(`Probing ${name}: ${url}`);
    
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);
      
      const response = await fetch(url, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      const responseTime = Date.now() - startTime;
      
      // Capture headers
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });
      
      let data: any = null;
      let responseSize = 0;
      try {
        const text = await response.text();
        responseSize = new Blob([text]).size;
        data = JSON.parse(text);
      } catch {
        // Response might not be JSON
      }

      const hasDeviceRef = data?.error?.includes('device_ref') || 
                           JSON.stringify(data).includes('device_ref');
      
      if (hasDeviceRef) {
        addLog(`⚠️ ${name}: OLD BACKEND DETECTED (device_ref error)`);
      }

      // Determine status
      const validStatuses = expectedStatus || [200];
      const isExpectedStatus = validStatuses.includes(response.status) || 
                               (response.status === 404 && endpoint.includes('health_check')) ||
                               (response.status === 401 && endpoint.includes('health_check'));
      
      let status: 'success' | 'error' | 'warning' = 'error';
      if (response.ok) {
        status = 'success';
      } else if (isExpectedStatus) {
        status = 'warning';
      }

      const result: HealthCheckResult = {
        endpoint,
        name,
        status,
        statusCode: response.status,
        responseTime,
        message: data?.message || data?.error || response.statusText,
        serverVersion: data?.version,
        hasDeviceRef,
        timestamp: new Date().toISOString(),
        headers,
        responseSize,
      };

      const icon = status === 'success' ? '✅' : status === 'warning' ? '⚠️' : '❌';
      addLog(`${icon} ${name}: ${response.status} (${responseTime}ms, ${responseSize} bytes)`);
      
      return result;
    } catch (error: any) {
      const responseTime = Date.now() - startTime;
      const message = error.name === 'AbortError' ? 'Request timed out' : error.message;
      addLog(`❌ ${name}: ${message} (${responseTime}ms)`);
      
      return {
        endpoint,
        name,
        status: 'error',
        responseTime,
        message,
        timestamp: new Date().toISOString(),
      };
    }
  };

  const checkDeviceStatus = async (fingerprint: string): Promise<DeviceInfo> => {
    addLog(`📱 Checking device registration: ${fingerprint.substring(0, 16)}...`);
    
    const info: DeviceInfo = {
      fingerprint,
      isRegistered: false,
      isApproved: false,
      isAuthorized: false,
    };

    try {
      const response = await fetch(
        `${API_CONFIG.MYSQL_API_URL}/api/devices/fingerprint/${encodeURIComponent(fingerprint)}`,
        { method: 'GET', headers: { 'Content-Type': 'application/json' } }
      );

      if (response.ok) {
        const data = await response.json();
        if (data.success && data.data) {
          info.isRegistered = true;
          info.isApproved = data.data.approved === 1 || data.data.approved === true;
          info.isAuthorized = data.data.authorized === 1 || data.data.authorized === true;
          info.devcode = data.data.devcode;
          addLog(`📱 Device found: approved=${info.isApproved}, authorized=${info.isAuthorized}`);
        }
      } else if (response.status === 404) {
        addLog(`📱 Device not registered in backend`);
      }

      // Check routes if device is authorized
      if (info.isAuthorized && info.devcode) {
        try {
          const routesResp = await fetch(
            `${API_CONFIG.MYSQL_API_URL}/api/routes/by-device/${fingerprint}`,
            { method: 'GET' }
          );
          if (routesResp.ok) {
            const routesData = await routesResp.json();
            info.routeCount = routesData.data?.length || 0;
          }
        } catch { /* ignore */ }

        try {
          const sessionsResp = await fetch(
            `${API_CONFIG.MYSQL_API_URL}/api/sessions/by-device/${fingerprint}`,
            { method: 'GET' }
          );
          if (sessionsResp.ok) {
            const sessionsData = await sessionsResp.json();
            info.sessionCount = sessionsData.data?.length || 0;
          }
        } catch { /* ignore */ }
      }
    } catch (error) {
      addLog(`❌ Device check failed: ${error}`);
    }

    return info;
  };

  const runHealthChecks = useCallback(async () => {
    setIsChecking(true);
    setHealthChecks([]);
    setCheckProgress(0);
    addLog('═══════════════════════════════════════════');
    addLog('=== Starting Comprehensive Backend Health Check ===');
    addLog(`Target: ${API_CONFIG.MYSQL_API_URL}`);
    addLog(`Timestamp: ${new Date().toISOString()}`);
    addLog('═══════════════════════════════════════════');

    // Get connection stats
    const connStats = getConnectionStats();
    setConnectionStats(connStats);
    addLog(`📶 Connection: ${connStats.effectiveType} (${connStats.downlink} Mbps)`);

    const results: HealthCheckResult[] = [];
    const totalChecks = 6;
    let completedChecks = 0;

    const updateProgress = () => {
      completedChecks++;
      setCheckProgress((completedChecks / totalChecks) * 100);
    };

    // Check 1: Version endpoint (new backend indicator)
    addLog('--- Phase 1: Version Check ---');
    const versionCheck = await checkEndpoint('/api/version', 'Version Endpoint', [200]);
    results.push(versionCheck);
    updateProgress();

    // Check 2: Database health (if version endpoint returned data)
    addLog('--- Phase 2: Database Connectivity ---');
    const testFingerprint = 'health_check_probe_' + Date.now();
    const deviceCheck = await checkEndpoint(
      `/api/devices/fingerprint/${testFingerprint}`,
      'Device Lookup (DB Query)',
      [404, 200]
    );
    results.push(deviceCheck);
    updateProgress();

    // Check 3: Auth system check
    addLog('--- Phase 3: Authorization System ---');
    const routesCheck = await checkEndpoint(
      `/api/routes/by-device/${testFingerprint}`,
      'Routes (Auth Check)',
      [401, 200]
    );
    results.push(routesCheck);
    updateProgress();

    // Check 4: Sessions endpoint
    const sessionsCheck = await checkEndpoint(
      `/api/sessions/by-device/${testFingerprint}`,
      'Sessions (Auth Check)',
      [401, 200]
    );
    results.push(sessionsCheck);
    updateProgress();

    // Check 5: Items endpoint
    addLog('--- Phase 4: Data Endpoints ---');
    const itemsCheck = await checkEndpoint(
      `/api/items?uniquedevcode=${testFingerprint}`,
      'Items Catalog',
      [401, 200]
    );
    results.push(itemsCheck);
    updateProgress();

    // Check 6: Farmers endpoint
    const farmersCheck = await checkEndpoint(
      `/api/farmers/by-device/${testFingerprint}`,
      'Farmers Data',
      [401, 200]
    );
    results.push(farmersCheck);
    updateProgress();

    setHealthChecks(results);

    // Calculate stats
    const avgResponseTime = results.reduce((sum, r) => sum + (r.responseTime || 0), 0) / results.length;
    const healthyCount = results.filter(r => r.status === 'success' || r.status === 'warning').length;

    // Determine backend status
    const hasVersionEndpoint = versionCheck.status === 'success';
    const hasDeviceRefIssue = results.some(r => r.hasDeviceRef);
    const isNewBackend = hasVersionEndpoint && !hasDeviceRefIssue;
    
    // Parse version info
    let nodeVersion: string | undefined;
    if (versionCheck.status === 'success') {
      try {
        const versionData = await fetch(`${API_CONFIG.MYSQL_API_URL}/api/version`).then(r => r.json());
        nodeVersion = versionData.node;
      } catch { /* ignore */ }
    }

    const info: BackendInfo = {
      isNewBackend,
      version: versionCheck.serverVersion,
      nodeVersion,
      hasVersionEndpoint,
      hasDeviceRefIssue,
      lastCheck: new Date().toISOString(),
      averageResponseTime: Math.round(avgResponseTime),
      totalEndpoints: results.length,
      healthyEndpoints: healthyCount,
    };
    
    setBackendInfo(info);

    // Check actual device status
    addLog('--- Phase 5: Device Registration Status ---');
    try {
      const fingerprint = await generateDeviceFingerprint();
      const devInfo = await checkDeviceStatus(fingerprint);
      setDeviceInfo(devInfo);
    } catch (error) {
      addLog(`❌ Failed to get device fingerprint: ${error}`);
    }

    // Final summary
    addLog('═══════════════════════════════════════════');
    if (isNewBackend) {
      addLog('✅ RESULT: NEW BACKEND - All systems operational');
    } else if (hasDeviceRefIssue) {
      addLog('⚠️ RESULT: OLD BACKEND - device_ref column issue detected');
    } else if (!hasVersionEndpoint) {
      addLog('⚠️ RESULT: LEGACY BACKEND - Missing /api/version endpoint');
    }
    addLog(`📊 Stats: ${healthyCount}/${results.length} endpoints healthy, avg ${Math.round(avgResponseTime)}ms`);
    addLog('=== Health Check Complete ===');
    addLog('═══════════════════════════════════════════');

    setIsChecking(false);
  }, [addLog, getConnectionStats]);

  useEffect(() => {
    runHealthChecks();
  }, []);

  const getStatusBadge = (status: 'success' | 'error' | 'pending' | 'warning') => {
    switch (status) {
      case 'success':
        return <Badge variant="default" className="gap-1 bg-green-600"><CheckCircle2 className="h-3 w-3" />OK</Badge>;
      case 'warning':
        return <Badge variant="secondary" className="gap-1 bg-amber-500 text-amber-950"><AlertTriangle className="h-3 w-3" />Expected</Badge>;
      case 'error':
        return <Badge variant="destructive" className="gap-1"><XCircle className="h-3 w-3" />Error</Badge>;
      case 'pending':
        return <Badge variant="secondary" className="gap-1"><Clock className="h-3 w-3" />Pending</Badge>;
    }
  };

  const getResponseTimeColor = (ms?: number) => {
    if (!ms) return 'text-muted-foreground';
    if (ms < 500) return 'text-green-600';
    if (ms < 1000) return 'text-amber-600';
    return 'text-destructive';
  };

  const getHealthScore = () => {
    if (!backendInfo) return 0;
    return Math.round((backendInfo.healthyEndpoints / backendInfo.totalEndpoints) * 100);
  };

  return (
    <div className="min-h-screen bg-background p-4 pb-20">
      <div className="max-w-3xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate("/settings")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex-1">
            <h1 className="text-2xl font-bold">Backend Status</h1>
            <p className="text-sm text-muted-foreground flex items-center gap-1">
              <Globe className="h-3 w-3" />
              {API_CONFIG.MYSQL_API_URL}
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

        {/* Progress bar during check */}
        {isChecking && (
          <div className="space-y-2">
            <Progress value={checkProgress} className="h-2" />
            <p className="text-xs text-muted-foreground text-center">
              Running health checks... {Math.round(checkProgress)}%
            </p>
          </div>
        )}

        {/* Quick Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card className="p-3">
            <div className="flex items-center gap-2">
              <Activity className={`h-4 w-4 ${backendInfo?.isNewBackend ? 'text-green-500' : 'text-amber-500'}`} />
              <div>
                <p className="text-xs text-muted-foreground">Status</p>
                <p className="font-semibold text-sm">
                  {backendInfo?.isNewBackend ? 'Healthy' : backendInfo?.hasDeviceRefIssue ? 'Outdated' : 'Unknown'}
                </p>
              </div>
            </div>
          </Card>
          
          <Card className="p-3">
            <div className="flex items-center gap-2">
              <Timer className="h-4 w-4 text-primary" />
              <div>
                <p className="text-xs text-muted-foreground">Avg Response</p>
                <p className={`font-semibold text-sm ${getResponseTimeColor(backendInfo?.averageResponseTime)}`}>
                  {backendInfo?.averageResponseTime || '-'}ms
                </p>
              </div>
            </div>
          </Card>
          
          <Card className="p-3">
            <div className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-primary" />
              <div>
                <p className="text-xs text-muted-foreground">Health Score</p>
                <p className="font-semibold text-sm">{getHealthScore()}%</p>
              </div>
            </div>
          </Card>
          
          <Card className="p-3">
            <div className="flex items-center gap-2">
              {navigator.onLine ? (
                <Wifi className="h-4 w-4 text-green-500" />
              ) : (
                <WifiOff className="h-4 w-4 text-destructive" />
              )}
              <div>
                <p className="text-xs text-muted-foreground">Connection</p>
                <p className="font-semibold text-sm capitalize">
                  {connectionStats?.effectiveType || 'Unknown'}
                </p>
              </div>
            </div>
          </Card>
        </div>

        <Tabs defaultValue="overview" className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="endpoints">Endpoints</TabsTrigger>
            <TabsTrigger value="device">Device</TabsTrigger>
            <TabsTrigger value="logs">Logs</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-4 mt-4">
            {/* Backend Status Summary */}
            <Card className={
              backendInfo?.isNewBackend ? 'border-green-500/50' : 
              backendInfo?.hasDeviceRefIssue ? 'border-destructive/50' : 
              'border-amber-500/50'
            }>
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
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div className="space-y-3">
                      <div className="flex justify-between items-center">
                        <span className="text-muted-foreground flex items-center gap-1">
                          <Zap className="h-3 w-3" /> Version Endpoint
                        </span>
                        <span className={backendInfo.hasVersionEndpoint ? 'text-green-600 font-medium' : 'text-destructive font-medium'}>
                          {backendInfo.hasVersionEndpoint ? '✓ Available' : '✗ Missing'}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-muted-foreground flex items-center gap-1">
                          <Shield className="h-3 w-3" /> device_ref Issue
                        </span>
                        <span className={!backendInfo.hasDeviceRefIssue ? 'text-green-600 font-medium' : 'text-destructive font-medium'}>
                          {backendInfo.hasDeviceRefIssue ? '✗ Detected' : '✓ None'}
                        </span>
                      </div>
                    </div>
                    <div className="space-y-3">
                      {backendInfo.version && (
                        <div className="flex justify-between items-center">
                          <span className="text-muted-foreground flex items-center gap-1">
                            <HardDrive className="h-3 w-3" /> Server Version
                          </span>
                          <span className="font-mono text-xs">{backendInfo.version.substring(0, 30)}</span>
                        </div>
                      )}
                      {backendInfo.nodeVersion && (
                        <div className="flex justify-between items-center">
                          <span className="text-muted-foreground flex items-center gap-1">
                            <Cpu className="h-3 w-3" /> Node.js
                          </span>
                          <span className="font-mono text-xs">{backendInfo.nodeVersion}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {backendInfo?.hasDeviceRefIssue && (
                  <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm border border-destructive/20">
                    <strong>⚠️ Action Required:</strong> The backend is running an old version that references 
                    the <code className="bg-destructive/20 px-1 rounded">device_ref</code> column. 
                    Please redeploy <code className="bg-destructive/20 px-1 rounded">backend-api/server.js</code> to the server.
                  </div>
                )}

                {backendInfo && !backendInfo.hasVersionEndpoint && !backendInfo.hasDeviceRefIssue && (
                  <div className="p-3 rounded-lg bg-amber-500/10 text-amber-700 dark:text-amber-400 text-sm border border-amber-500/20">
                    <strong>ℹ️ Note:</strong> The <code className="bg-amber-500/20 px-1 rounded">/api/version</code> endpoint is missing. 
                    Consider deploying the latest backend version.
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Connection Info */}
            {connectionStats && (
              <Card>
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-2">
                    <Wifi className="h-4 w-4 text-primary" />
                    <CardTitle className="text-base">Network Connection</CardTitle>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-3 gap-4 text-sm">
                    <div>
                      <p className="text-muted-foreground">Type</p>
                      <p className="font-medium capitalize">{connectionStats.connectionType}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Quality</p>
                      <p className="font-medium capitalize">{connectionStats.effectiveType}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Downlink</p>
                      <p className="font-medium">{connectionStats.downlink} Mbps</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="endpoints" className="space-y-4 mt-4">
            <Card>
              <CardHeader>
                <div className="flex items-center gap-3">
                  <Database className="h-5 w-5 text-primary" />
                  <div>
                    <CardTitle>API Endpoints</CardTitle>
                    <CardDescription>
                      {backendInfo ? `${backendInfo.healthyEndpoints}/${backendInfo.totalEndpoints} endpoints responding` : 'Checking...'}
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {healthChecks.length === 0 && isChecking && (
                    <div className="text-center py-8 text-muted-foreground">
                      <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-2" />
                      Checking endpoints...
                    </div>
                  )}
                  {healthChecks.map((check, index) => (
                    <div key={index} className="flex items-center justify-between p-3 rounded-lg bg-muted/50 hover:bg-muted/70 transition-colors">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm truncate">{check.name}</div>
                        <div className="text-xs text-muted-foreground truncate">
                          {check.endpoint}
                        </div>
                        {check.message && (
                          <div className="text-xs mt-1 text-muted-foreground truncate">
                            {check.message}
                            {check.hasDeviceRef && (
                              <span className="text-destructive ml-2">[device_ref error]</span>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-3 flex-shrink-0 ml-2">
                        <div className="text-right">
                          <div className={`text-xs font-mono ${getResponseTimeColor(check.responseTime)}`}>
                            {check.responseTime}ms
                          </div>
                          {check.responseSize && (
                            <div className="text-xs text-muted-foreground">
                              {check.responseSize} B
                            </div>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground w-8 text-center">
                          {check.statusCode || '-'}
                        </div>
                        {getStatusBadge(check.status)}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="device" className="space-y-4 mt-4">
            <Card>
              <CardHeader>
                <div className="flex items-center gap-3">
                  <Shield className="h-5 w-5 text-primary" />
                  <div>
                    <CardTitle>Device Registration</CardTitle>
                    <CardDescription>This device's registration status with the backend</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {deviceInfo ? (
                  <>
                    <div className="p-3 rounded-lg bg-muted/50 font-mono text-xs break-all">
                      {deviceInfo.fingerprint}
                    </div>
                    
                    <div className="grid grid-cols-2 gap-4">
                      <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                        <span className="text-sm">Registered</span>
                        {deviceInfo.isRegistered ? (
                          <Badge className="bg-green-600"><CheckCircle2 className="h-3 w-3 mr-1" />Yes</Badge>
                        ) : (
                          <Badge variant="destructive"><XCircle className="h-3 w-3 mr-1" />No</Badge>
                        )}
                      </div>
                      <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                        <span className="text-sm">Approved</span>
                        {deviceInfo.isApproved ? (
                          <Badge className="bg-green-600"><CheckCircle2 className="h-3 w-3 mr-1" />Yes</Badge>
                        ) : (
                          <Badge variant="secondary"><Clock className="h-3 w-3 mr-1" />Pending</Badge>
                        )}
                      </div>
                      <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                        <span className="text-sm">Authorized</span>
                        {deviceInfo.isAuthorized ? (
                          <Badge className="bg-green-600"><CheckCircle2 className="h-3 w-3 mr-1" />Yes</Badge>
                        ) : (
                          <Badge variant="secondary"><Clock className="h-3 w-3 mr-1" />Pending</Badge>
                        )}
                      </div>
                      {deviceInfo.devcode && (
                        <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                          <span className="text-sm">Devcode</span>
                          <span className="font-mono text-xs">{deviceInfo.devcode}</span>
                        </div>
                      )}
                    </div>

                    {deviceInfo.isAuthorized && (
                      <div className="grid grid-cols-2 gap-4">
                        <div className="p-3 rounded-lg bg-muted/50 text-center">
                          <p className="text-2xl font-bold">{deviceInfo.routeCount ?? '-'}</p>
                          <p className="text-xs text-muted-foreground">Routes Assigned</p>
                        </div>
                        <div className="p-3 rounded-lg bg-muted/50 text-center">
                          <p className="text-2xl font-bold">{deviceInfo.sessionCount ?? '-'}</p>
                          <p className="text-xs text-muted-foreground">Sessions Available</p>
                        </div>
                      </div>
                    )}

                    {!deviceInfo.isRegistered && (
                      <div className="p-3 rounded-lg bg-amber-500/10 text-amber-700 dark:text-amber-400 text-sm flex items-start gap-2">
                        <Info className="h-4 w-4 mt-0.5 flex-shrink-0" />
                        <span>This device is not registered with the backend. It will be auto-registered on next login attempt.</span>
                      </div>
                    )}

                    {deviceInfo.isRegistered && !deviceInfo.isApproved && (
                      <div className="p-3 rounded-lg bg-blue-500/10 text-blue-700 dark:text-blue-400 text-sm flex items-start gap-2">
                        <Info className="h-4 w-4 mt-0.5 flex-shrink-0" />
                        <span>This device is registered but awaiting admin approval. Contact your administrator.</span>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-2" />
                    Loading device info...
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="logs" className="space-y-4 mt-4">
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Request Logs</CardTitle>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={() => setLogs([])}
                    className="text-xs"
                  >
                    Clear
                  </Button>
                </div>
                <CardDescription>Detailed probe activity ({logs.length} entries)</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="bg-muted/50 rounded-lg p-3 max-h-96 overflow-y-auto">
                  <pre className="text-xs font-mono space-y-0.5">
                    {logs.length === 0 ? (
                      <span className="text-muted-foreground">No logs yet...</span>
                    ) : (
                      logs.map((log, i) => (
                        <div key={i} className={
                          log.includes('✅') || log.includes('RESULT: NEW') ? 'text-green-600' :
                          log.includes('❌') || log.includes('Error') ? 'text-destructive' :
                          log.includes('⚠️') || log.includes('OLD') ? 'text-amber-600' :
                          log.includes('===') ? 'text-primary font-semibold' :
                          log.includes('---') ? 'text-muted-foreground italic' :
                          log.includes('📱') ? 'text-blue-500' :
                          log.includes('📶') || log.includes('📊') ? 'text-cyan-500' :
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
          </TabsContent>
        </Tabs>

        {/* Last check timestamp */}
        {backendInfo && (
          <p className="text-xs text-muted-foreground text-center">
            Last checked: {new Date(backendInfo.lastCheck).toLocaleString()}
          </p>
        )}
      </div>
    </div>
  );
};

export default BackendStatus;