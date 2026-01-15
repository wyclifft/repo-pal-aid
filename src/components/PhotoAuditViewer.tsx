import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { X, Search, ChevronLeft, ChevronRight, Image, Calendar, User, FileText, Loader2 } from 'lucide-react';
import { API_CONFIG } from '@/config/api';

interface TransactionPhoto {
  ID: number;
  transrefno: string;
  memberno: string;
  transdate: string;
  transtime: string;
  clerk: string;
  amount: number;
  photo_filename: string;
  photo_directory: string;
}

interface PhotoAuditViewerProps {
  open: boolean;
  onClose: () => void;
}

const PhotoAuditViewer = ({ open, onClose }: PhotoAuditViewerProps) => {
  const [photos, setPhotos] = useState<TransactionPhoto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPhoto, setSelectedPhoto] = useState<TransactionPhoto | null>(null);
  const [dateFilter, setDateFilter] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const pageSize = 20;

  // Fetch transaction photos from server
  const fetchPhotos = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const apiUrl = API_CONFIG.MYSQL_API_URL;
      const params = new URLSearchParams({
        page: currentPage.toString(),
        limit: pageSize.toString(),
      });
      
      if (searchQuery.trim()) {
        params.append('search', searchQuery.trim());
      }
      if (dateFilter) {
        params.append('date', dateFilter);
      }
      
      const response = await fetch(`${apiUrl}/api/transaction-photos?${params}`, {
        signal: AbortSignal.timeout(10000),
      });
      
      if (!response.ok) {
        throw new Error(`Failed to fetch photos: ${response.status}`);
      }
      
      const data = await response.json();
      
      if (data.success) {
        setPhotos(data.data || []);
        setTotalCount(data.total || 0);
      } else {
        throw new Error(data.error || 'Failed to load photos');
      }
    } catch (err) {
      console.error('Error fetching photos:', err);
      setError(err instanceof Error ? err.message : 'Failed to load photos');
      setPhotos([]);
    } finally {
      setLoading(false);
    }
  };

  // Load photos when dialog opens or filters change
  useEffect(() => {
    if (open) {
      fetchPhotos();
    }
  }, [open, currentPage, dateFilter]);

  // Reset to page 1 when search/filter changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, dateFilter]);

  // Build full photo URL
  const getPhotoUrl = (photo: TransactionPhoto): string => {
    const apiUrl = API_CONFIG.MYSQL_API_URL;
    // Construct URL from directory and filename
    if (photo.photo_directory && photo.photo_filename) {
      return `${apiUrl}/${photo.photo_directory}/${photo.photo_filename}`;
    }
    return '';
  };

  // Handle search on Enter
  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      fetchPhotos();
    }
  };

  const totalPages = Math.ceil(totalCount / pageSize);

  return (
    <>
      {/* Main Photo List Dialog */}
      <Dialog open={open && !selectedPhoto} onOpenChange={(isOpen) => !isOpen && onClose()}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] p-0 overflow-hidden" hideCloseButton>
          <DialogHeader className="px-4 py-3 border-b bg-[#5E35B1] text-white flex flex-row items-center justify-between">
            <DialogTitle className="text-white flex items-center gap-2">
              <Image className="h-5 w-5" />
              Photo Audit Viewer
            </DialogTitle>
            <button onClick={onClose} className="p-2 bg-[#E53935] text-white rounded">
              <X className="h-4 w-4" />
            </button>
          </DialogHeader>
          
          <div className="p-4 space-y-4">
            {/* Filters */}
            <div className="flex gap-2 flex-wrap">
              <div className="flex-1 min-w-[200px]">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search by member, ref, clerk..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={handleSearchKeyDown}
                    className="w-full pl-10 pr-4 py-2 border rounded-lg text-sm"
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-gray-500" />
                <input
                  type="date"
                  value={dateFilter}
                  onChange={(e) => setDateFilter(e.target.value)}
                  className="px-3 py-2 border rounded-lg text-sm"
                />
              </div>
              <button
                onClick={fetchPhotos}
                className="px-4 py-2 bg-[#5E35B1] text-white rounded-lg text-sm font-medium"
              >
                Search
              </button>
            </div>

            {/* Results Info */}
            <div className="text-sm text-gray-500">
              {loading ? 'Loading...' : `${totalCount} transaction(s) with photos`}
            </div>

            {/* Photo Grid */}
            <div className="max-h-[50vh] overflow-y-auto">
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-[#5E35B1]" />
                </div>
              ) : error ? (
                <div className="text-center py-8 text-red-500">
                  <p className="font-medium">Error loading photos</p>
                  <p className="text-sm mt-1">{error}</p>
                  <button
                    onClick={fetchPhotos}
                    className="mt-3 px-4 py-2 bg-gray-100 rounded text-sm"
                  >
                    Retry
                  </button>
                </div>
              ) : photos.length === 0 ? (
                <div className="text-center py-12 text-gray-400">
                  <Image className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p className="font-medium">No photos found</p>
                  <p className="text-sm">Try adjusting your search filters</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {photos.map((photo) => (
                    <button
                      key={photo.ID}
                      onClick={() => setSelectedPhoto(photo)}
                      className="bg-gray-50 rounded-lg overflow-hidden border hover:border-[#5E35B1] transition-colors text-left"
                    >
                      <div className="aspect-square bg-gray-200 relative">
                        <img
                          src={getPhotoUrl(photo)}
                          alt={`Transaction ${photo.transrefno}`}
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            e.currentTarget.style.display = 'none';
                            e.currentTarget.nextElementSibling?.classList.remove('hidden');
                          }}
                        />
                        <div className="hidden absolute inset-0 flex items-center justify-center bg-gray-100">
                          <Image className="h-8 w-8 text-gray-300" />
                        </div>
                      </div>
                      <div className="p-2">
                        <div className="text-xs font-mono text-gray-500 truncate">
                          {photo.transrefno}
                        </div>
                        <div className="text-xs text-gray-600 truncate">
                          {photo.memberno}
                        </div>
                        <div className="text-xs text-gray-400">
                          {photo.transdate}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between pt-3 border-t">
                <button
                  onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                  disabled={currentPage === 1}
                  className="flex items-center gap-1 px-3 py-1.5 text-sm border rounded disabled:opacity-50"
                >
                  <ChevronLeft className="h-4 w-4" />
                  Previous
                </button>
                <span className="text-sm text-gray-500">
                  Page {currentPage} of {totalPages}
                </span>
                <button
                  onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                  disabled={currentPage === totalPages}
                  className="flex items-center gap-1 px-3 py-1.5 text-sm border rounded disabled:opacity-50"
                >
                  Next
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Photo Detail Dialog */}
      <Dialog open={!!selectedPhoto} onOpenChange={(isOpen) => !isOpen && setSelectedPhoto(null)}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] p-0 overflow-hidden" hideCloseButton>
          <DialogHeader className="px-4 py-3 border-b bg-[#5E35B1] text-white flex flex-row items-center justify-between">
            <DialogTitle className="text-white text-sm truncate flex-1">
              {selectedPhoto?.transrefno || 'Photo Details'}
            </DialogTitle>
            <button onClick={() => setSelectedPhoto(null)} className="p-2 bg-[#E53935] text-white rounded ml-2">
              <X className="h-4 w-4" />
            </button>
          </DialogHeader>
          
          {selectedPhoto && (
            <div className="p-4 space-y-4">
              {/* Photo Display */}
              <div className="bg-gray-100 rounded-lg overflow-hidden">
                <img
                  src={getPhotoUrl(selectedPhoto)}
                  alt={`Transaction ${selectedPhoto.transrefno}`}
                  className="w-full h-auto max-h-[40vh] object-contain"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                    e.currentTarget.nextElementSibling?.classList.remove('hidden');
                  }}
                />
                <div className="hidden text-center py-12 text-gray-400">
                  <Image className="h-12 w-12 mx-auto mb-2" />
                  <p className="text-sm">Image not available</p>
                </div>
              </div>

              {/* Transaction Details */}
              <div className="bg-gray-50 rounded-lg p-4 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="flex items-center gap-1 text-xs text-gray-500">
                      <FileText className="h-3 w-3" />
                      Reference
                    </div>
                    <div className="font-mono text-sm font-medium">{selectedPhoto.transrefno}</div>
                  </div>
                  <div>
                    <div className="flex items-center gap-1 text-xs text-gray-500">
                      <User className="h-3 w-3" />
                      Member
                    </div>
                    <div className="text-sm font-medium">{selectedPhoto.memberno}</div>
                  </div>
                </div>
                
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="flex items-center gap-1 text-xs text-gray-500">
                      <Calendar className="h-3 w-3" />
                      Date
                    </div>
                    <div className="text-sm">{selectedPhoto.transdate}</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500">Time</div>
                    <div className="text-sm">{selectedPhoto.transtime}</div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-xs text-gray-500">Clerk</div>
                    <div className="text-sm font-medium">{selectedPhoto.clerk || 'N/A'}</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500">Amount</div>
                    <div className="text-sm font-bold text-green-600">
                      KES {(selectedPhoto.amount || 0).toLocaleString()}
                    </div>
                  </div>
                </div>

                {/* File Info */}
                <div className="pt-2 border-t text-xs text-gray-400">
                  <div className="truncate">File: {selectedPhoto.photo_filename}</div>
                  <div className="truncate">Path: {selectedPhoto.photo_directory}</div>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
};

export default PhotoAuditViewer;
