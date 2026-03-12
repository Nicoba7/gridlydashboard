import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import HowItWorks from "./pages/HowItWorks";
import CustomerValue from "./pages/CustomerValue";
import NetworkGrowth from "./pages/NetworkGrowth";
import MarketOpportunity from "./pages/MarketOpportunity";
import Onboarding from "./pages/Onboarding";
import Landing from "./pages/Landing";
import SimplifiedDashboard from "./pages/SimplifiedDashboard";
import DeviceManagement from "./pages/DeviceManagement";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/onboarding" element={<Onboarding />} />
          <Route path="/dashboard" element={<SimplifiedDashboard />} />
          <Route path="/devices" element={<DeviceManagement />} />
          <Route path="/how-it-works" element={<HowItWorks />} />
          <Route path="/customer-value" element={<CustomerValue />} />
          <Route path="/network-growth" element={<NetworkGrowth />} />
          <Route path="/market-opportunity" element={<MarketOpportunity />} />
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
