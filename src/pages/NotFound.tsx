import { useLocation, useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";

const NotFound = () => {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
    
    // On Capacitor (native) apps, auto-redirect to home since there's no address bar
    if (Capacitor.isNativePlatform()) {
      console.log("📱 Native app detected - auto-redirecting to home from 404");
      navigate("/", { replace: true });
    }
  }, [location.pathname, navigate]);

  // Web users see the 404 page; native users are redirected before this renders
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-100">
      <div className="text-center">
        <h1 className="mb-4 text-4xl font-bold">404</h1>
        <p className="mb-4 text-xl text-gray-600">Oops! Page not found</p>
        <a href="/" className="text-blue-500 underline hover:text-blue-700">
          Return to Home
        </a>
      </div>
    </div>
  );
};

export default NotFound;
