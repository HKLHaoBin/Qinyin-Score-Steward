# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

千音雅集 (Repertoire of Myriad Melodies) is a Flask-based web application for managing Genshin Impact Windblume Lyre music scores. It provides clipboard monitoring, score completion tracking, batch querying, and automatic score extraction features.

## Key Commands

### Development
- **Install dependencies**: `pip install -r requirements.txt`
- **Run application**: `python app.py` (runs on port 6605)
- **Build executable**: `python setup.py` (creates standalone exe)

### Database Management
- **Database file**: `scores.db` (SQLite)
- **Backup location**: `backups/` directory (automatic backups)
- **Appreciation codes**: `The old appreciation code/` directory (extracted score codes)

## Architecture

### Backend (app.py)
- **Flask + Socket.IO**: Real-time communication for clipboard monitoring
- **SQLite Database**: Stores score codes, completion rates, favorites, and random pools
- **Selenium Integration**: Automated score extraction from miHoYo website
- **Threading**: Clipboard monitoring and Chrome initialization run in background threads

### Frontend Structure
- **Templates**: HTML files in `templates/` directory
  - `index.html`: Main interface with clipboard monitoring
  - `batch_query.html`: Batch query and exclusion functionality
  - `random_pool.html`: Random pool management interface
- **Static Assets**: JavaScript and CSS in `static/` directory
  - `script.js`: Main application logic
  - `batch_query.js`: Batch query specific functionality
  - `style.css`: Application styling

### Key Features
1. **Clipboard Monitoring**: Automatically detects and displays score codes from clipboard
2. **Completion Tracking**: Records 0-100% completion rates for scores
3. **Favorite Management**: Mark/unmark scores as favorites
4. **Batch Query**: Query multiple scores with exclusion capabilities
5. **Score Extraction**: Automated extraction from miHoYo website using Selenium
6. **Random Pools**: Create and manage pools of scores for random selection
7. **Real-time Sync**: Socket.IO enables real-time updates across clients

### API Endpoints
- `GET /api/scores`: Retrieve scores with filtering
- `POST /api/scores/save`: Save score completion rate
- `POST /api/scores/<code>/favorite`: Toggle favorite status
- `POST /api/scores/batch`: Batch query scores
- `GET /api/fetch_jianshang`: Extract scores from miHoYo website
- `GET /api/latest_jianshang_codes`: Get latest extracted score codes
- Random pool management endpoints under `/api/random_pool/`

### Database Schema
- **scores table**: score_code, completion, difficulty, region, is_favorite, created_at
- **random_pools table**: name, filter_json, codes_json, origin_codes_json, created_at

### Dependencies
- **Flask**: Web framework
- **Flask-SocketIO**: Real-time communication
- **Selenium**: Web automation for score extraction
- **Pyperclip**: Clipboard access
- **WebDriver Manager**: Chrome driver management

## Development Notes
- Uses port 6605 (not standard Flask port 5000)
- Chrome browser required for score extraction functionality
- Automatic database backups on application start
- Mobile-friendly responsive design
- Supports both Chinese and English interfaces
- Can be packaged as standalone executable