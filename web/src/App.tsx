import { Navigate, Route, Routes } from 'react-router-dom'
import { RequireAuth } from './auth/RequireAuth'
import { AddPersonPage } from './pages/AddPersonPage'
import { HomePage } from './pages/HomePage'
import { LoginPage } from './pages/LoginPage'
import { PeoplePage } from './pages/PeoplePage'
import { PersonPage } from './pages/PersonPage'
import { PrayerListPage } from './pages/PrayerListPage'
import { ReviewPage } from './pages/ReviewPage'

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <HomePage />
          </RequireAuth>
        }
      />
      <Route
        path="/people"
        element={
          <RequireAuth>
            <PeoplePage />
          </RequireAuth>
        }
      />
      {/* Before /people/:id, for readers; the router ranks the static segment first anyway. */}
      <Route
        path="/people/new"
        element={
          <RequireAuth>
            <AddPersonPage />
          </RequireAuth>
        }
      />
      <Route
        path="/people/:id"
        element={
          <RequireAuth>
            <PersonPage />
          </RequireAuth>
        }
      />
      <Route
        path="/prayer"
        element={
          <RequireAuth>
            <PrayerListPage />
          </RequireAuth>
        }
      />
      <Route
        path="/review"
        element={
          <RequireAuth>
            <ReviewPage />
          </RequireAuth>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
