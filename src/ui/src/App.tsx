import { Route, Routes, Link, useLocation, useNavigate } from "react-router-dom";
import { Sidebar, useSidebar } from "@cloudflare/kumo/components/sidebar";
import { Button } from "@cloudflare/kumo/components/button";
import { ToastProvider } from "@cloudflare/kumo/components/toast";
import {
  VinylRecordIcon,
  PuzzlePieceIcon,
  PaperPlaneTiltIcon,
  GearIcon,
  ListIcon,
  SparkleIcon,
} from "@phosphor-icons/react";
import CollectionPage from "./pages/CollectionPage";
import ExtensionsPage from "./pages/ExtensionsPage";
import SubmitPage from "./pages/SubmitPage";
import AdminPage from "./pages/AdminPage";
import ExtensionDetailPage from "./pages/ExtensionDetailPage";
import { useEffect, useState } from "react";
import { api, type Extension } from "./lib/api";
import { CodePreloader } from "./components/CodePreloader";

export default function App() {
  return (
    <ToastProvider>
      <Sidebar.Provider defaultOpen>
        <Shell />
      </Sidebar.Provider>

      {/* Ensures CodeHighlighted is included in the bundle for Phase 2 — hidden. */}
      <CodePreloader />
    </ToastProvider>
  );
}

// Prominent mobile top bar — the desktop sidebar collapses to an off-canvas
// sheet below 768px, so without this the nav (and the all-important Submit
// action) would be unreachable. Hidden on md+ where the sidebar is visible.
function MobileTopBar() {
  const navigate = useNavigate();
  const { toggleSidebar, setOpenMobile } = useSidebar();

  return (
    <div className="sticky top-0 z-30 flex items-center justify-between gap-2 border-b border-white/10 bg-kumo-base/95 px-3 py-2 backdrop-blur md:hidden">
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={toggleSidebar}
          aria-label="Open navigation"
          className="inline-flex size-10 items-center justify-center rounded-lg text-kumo-default transition hover:bg-white/10"
        >
          <ListIcon size={24} />
        </button>
        <span className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          <span className="inline-block size-5 rounded-full bg-gradient-to-br from-fuchsia-500 to-indigo-500 ring-2 ring-black/30" />
          Vinyl
        </span>
      </div>
      <Button
        variant="primary"
        onClick={() => {
          setOpenMobile(false);
          navigate("/submit");
        }}
        className="min-h-[40px] gap-1.5 px-4"
      >
        <SparkleIcon size={16} weight="fill" />
        Submit
      </Button>
    </div>
  );
}

function Shell() {
  const location = useLocation();
  const navigate = useNavigate();
  const { setOpenMobile } = useSidebar();
  const [extensions, setExtensions] = useState<Extension[]>([]);

  useEffect(() => {
    api.listExtensions().then((r) => setExtensions(r.extensions)).catch(() => {});
  }, [location.pathname]);

  const isActive = (p: string) =>
    p === "/"
      ? location.pathname === "/"
      : location.pathname.startsWith(p);

  // Navigate and close the mobile sheet so the destination is visible.
  const go = (p: string) => {
    navigate(p);
    setOpenMobile(false);
  };

  return (
    <div className="flex min-h-screen bg-kumo-base text-kumo-default">
      <Sidebar>
            <Sidebar.Header>
              <div className="flex items-center gap-2 px-2 py-1 text-sm font-semibold tracking-tight">
                <span className="inline-block size-6 rounded-full bg-gradient-to-br from-fuchsia-500 to-indigo-500 ring-2 ring-black/30" />
                Vinyl
              </div>
            </Sidebar.Header>
            <Sidebar.Content>
              <Sidebar.Group>
                <Sidebar.GroupLabel>Library</Sidebar.GroupLabel>
                <Sidebar.Menu>
                  <Sidebar.MenuItem>
                    <Sidebar.MenuButton
                      icon={VinylRecordIcon}
                      active={isActive("/")}
                      onClick={() => go("/")}
                    >
                      Collection
                    </Sidebar.MenuButton>
                  </Sidebar.MenuItem>
                  <Sidebar.MenuItem>
                    <Sidebar.MenuButton
                      icon={PuzzlePieceIcon}
                      active={isActive("/extensions")}
                      onClick={() => go("/extensions")}
                    >
                      Extensions
                      <Sidebar.MenuBadge>{extensions.length}</Sidebar.MenuBadge>
                    </Sidebar.MenuButton>
                  </Sidebar.MenuItem>
                  <Sidebar.MenuItem>
                    <Sidebar.MenuButton
                      icon={PaperPlaneTiltIcon}
                      active={isActive("/submit")}
                      onClick={() => go("/submit")}
                    >
                      Submit
                    </Sidebar.MenuButton>
                  </Sidebar.MenuItem>
                  <Sidebar.MenuItem>
                    <Sidebar.MenuButton
                      icon={GearIcon}
                      active={isActive("/admin")}
                      onClick={() => go("/admin")}
                    >
                      Admin
                    </Sidebar.MenuButton>
                  </Sidebar.MenuItem>
                </Sidebar.Menu>
              </Sidebar.Group>
            </Sidebar.Content>
            <Sidebar.Footer>
              <div className="px-2 py-2 text-[11px] text-kumo-subtle">
                Built for the Agent Era
              </div>
            </Sidebar.Footer>
          </Sidebar>

          <main className="flex-1 min-w-0">
            <MobileTopBar />
            <Routes>
              <Route path="/" element={<CollectionPage />} />
              <Route path="/extensions" element={<ExtensionsPage />} />
              <Route path="/submit" element={<SubmitPage />} />
              <Route path="/admin" element={<AdminPage />} />
              <Route path="/admin/extensions/:id" element={<ExtensionDetailPage />} />
              <Route
                path="*"
                element={
                  <div className="p-12 text-kumo-subtle">
                    Not found. <Link to="/" className="underline">Back to collection</Link>
                  </div>
                }
              />
            </Routes>
          </main>
        </div>
  );
}
