DEV_FRONTEND_DIR=frontend
BACKEND_DIR=backend

.PHONY: dev test build

dev:
	@echo "Starting backend (in background)..."
	cd $(BACKEND_DIR) && go run . & \
		echo "Starting frontend (vite)... (this runs in foreground)" && cd $(DEV_FRONTEND_DIR) && npm install && npm run dev

test:
	@echo "Running backend tests..."
	cd $(BACKEND_DIR) && go test ./...

build:
	@echo "Building frontend..."
	cd frontend && npm ci && npm run build
	@echo "Copying frontend build into backend/dist..."
	rm -rf backend/dist && mkdir -p backend/dist
	cp -r frontend/dist/* backend/dist/
	@echo "Building backend binary..."
	cd backend && go build -o ../bin/app .


