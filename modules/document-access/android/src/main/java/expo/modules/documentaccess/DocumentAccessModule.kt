package expo.modules.documentaccess

import android.net.Uri
import android.provider.DocumentsContract
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException

class DocumentAccessModule : Module() {
  private val context get() = appContext.reactContext ?: throw IOException("Application context unavailable")
  private val resolver get() = context.contentResolver
  private val documentsRoot get() = context.filesDir.canonicalFile

  override fun definition() = ModuleDefinition {
    Name("DocumentAccess")
    AsyncFunction("identity") { value: String, _: String? ->
      val uri = sourceUri(value)
      // A provider query distinguishes revoked/missing documents from valid identity keys.
      if (uri.scheme == "content") metadata(documentUri(uri)) else requireReadable(localFile(uri))
      identityResult(uri)
    }
    AsyncFunction("listDirectory") { value: String, _: String? ->
      val uri = sourceUri(value)
      mapOf("entries" to entries(uri), "rootUri" to accessRootUri(uri).toString())
    }
    AsyncFunction("resolveRelative") { rootValue: String, relativePath: String, _: String? ->
      val root = sourceUri(rootValue)
      val components = relativeComponents(relativePath)
      var current = root
      if (root.scheme == "file") {
        val rootFile = localFile(root)
        require(rootFile.isDirectory) { "Authorized root is not a directory" }
        var target = rootFile
        for (component in components) target = File(target, component)
        target = target.canonicalFile
        requireWithin(rootFile, target)
        requireReadable(target)
        current = Uri.fromFile(target)
      } else {
        require(DocumentsContract.isTreeUri(root)) { "Select the parent directory to resolve relative files" }
        require(metadata(documentUri(root))["isDirectory"] == true) { "Authorized root is not a directory" }
        for (component in components) {
          val matches = entries(current).filter { it["name"] == component }
          require(matches.size == 1) { "Relative file is missing or ambiguous: $component" }
          current = Uri.parse(matches.single()["uri"] as String)
        }
      }
      identityResult(current, accessRootUri(root))
    }
    AsyncFunction("copyToLocal") { value: String, destinationValue: String, _: String? ->
      val source = sourceUri(value)
      val destinationUri = Uri.parse(destinationValue)
      val destination = localFile(destinationUri)
      requireWithin(documentsRoot, destination)
      require(destination != documentsRoot) { "Destination must be a file below Documents" }
      require(!destination.exists()) { "Destination already exists" }
      val parent = destination.parentFile ?: throw IOException("Missing destination parent")
      if (!parent.isDirectory && !parent.mkdirs()) throw IOException("Cannot create destination directory")
      // Canonical checks happen both before and after creating parents.
      requireWithin(documentsRoot, parent.canonicalFile)
      val temporary = File.createTempFile(".document-access-", ".partial", parent)
      try {
        val input = if (source.scheme == "content") {
          resolver.openInputStream(documentUri(source)) ?: throw IOException("Provider did not return a readable stream")
        } else FileInputStream(localFile(source))
        input.use { stream ->
          FileOutputStream(temporary).use { output ->
            stream.copyTo(output, 128 * 1024)
            output.fd.sync()
          }
        }
        if (destination.exists() || !temporary.renameTo(destination)) throw IOException("Cannot finish local copy")
      } finally { temporary.delete() }
    }
  }

  private fun sourceUri(value: String): Uri {
    val uri = Uri.parse(value)
    require(uri.scheme == "content" || uri.scheme == "file") { "Only document-provider and local file URIs are supported" }
    require(uri.query == null && uri.fragment == null) { "URI query and fragment are not supported" }
    if (uri.scheme == "content") require(!uri.authority.isNullOrBlank()) { "Document URI has no provider authority" }
    else requireWithin(documentsRoot, localFile(uri))
    return uri
  }

  private fun localFile(uri: Uri): File {
    require(uri.scheme == "file" && (uri.authority.isNullOrEmpty() || uri.authority == "localhost")) { "Expected a local file URI" }
    require(uri.query == null && uri.fragment == null) { "Invalid local file URI" }
    return File(uri.path ?: throw IOException("File URI has no path")).canonicalFile
  }

  private fun requireWithin(root: File, target: File) {
    val rootPath = root.canonicalPath
    val targetPath = target.canonicalPath
    require(targetPath == rootPath || targetPath.startsWith(rootPath + File.separator)) { "Path leaves authorized root" }
  }

  private fun requireReadable(file: File) {
    if (!file.exists() || !file.canRead()) throw IOException("File is missing or cannot be accessed")
  }

  private fun documentUri(uri: Uri): Uri {
    if (!DocumentsContract.isTreeUri(uri)) return uri
    val documentId = if (DocumentsContract.isDocumentUri(context, uri)) DocumentsContract.getDocumentId(uri)
      else DocumentsContract.getTreeDocumentId(uri)
    return DocumentsContract.buildDocumentUriUsingTree(uri, documentId)
  }

  private fun accessRootUri(uri: Uri): Uri = if (uri.scheme == "content" && DocumentsContract.isTreeUri(uri)) {
    DocumentsContract.buildTreeDocumentUri(uri.authority, DocumentsContract.getTreeDocumentId(uri))
  } else uri

  private fun identityResult(uri: Uri, root: Uri = accessRootUri(uri)): Map<String, Any?> =
    mapOf("uri" to uri.toString(), "identity" to stableIdentity(uri), "rootUri" to root.toString())

  private fun stableIdentity(uri: Uri): String {
    if (uri.scheme == "file") return "file:${localFile(uri).path}"
    val document = documentUri(uri)
    require(DocumentsContract.isDocumentUri(context, document)) { "Provider URI is not a SAF document" }
    return "android:${Uri.encode(document.authority)}:${Uri.encode(DocumentsContract.getDocumentId(document))}"
  }

  private val projection = arrayOf(
    DocumentsContract.Document.COLUMN_DOCUMENT_ID,
    DocumentsContract.Document.COLUMN_DISPLAY_NAME,
    DocumentsContract.Document.COLUMN_MIME_TYPE,
    DocumentsContract.Document.COLUMN_SIZE
  )

  private fun metadata(uri: Uri): Map<String, Any?> {
    val cursor = resolver.query(uri, projection, null, null, null) ?: throw IOException("Provider query failed")
    cursor.use {
      requireCompleteQuery(it)
      if (!it.moveToFirst()) throw IOException("Document no longer exists")
      val id = it.getString(it.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_DOCUMENT_ID))
      val child = if (DocumentsContract.isTreeUri(uri)) DocumentsContract.buildDocumentUriUsingTree(uri, id)
        else DocumentsContract.buildDocumentUri(uri.authority, id)
      return cursorEntry(it, child)
    }
  }

  private fun cursorEntry(cursor: android.database.Cursor, uri: Uri): Map<String, Any?> {
    val sizeIndex = cursor.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_SIZE)
    return mapOf(
      "name" to (cursor.getString(cursor.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_DISPLAY_NAME))
        ?: DocumentsContract.getDocumentId(uri)),
      "uri" to uri.toString(),
      "isDirectory" to (cursor.getString(cursor.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_MIME_TYPE)) == DocumentsContract.Document.MIME_TYPE_DIR),
      "size" to if (cursor.isNull(sizeIndex)) null else cursor.getLong(sizeIndex),
      "identity" to stableIdentity(uri)
    )
  }

  private fun entries(uri: Uri): List<Map<String, Any?>> {
    if (uri.scheme == "file") {
      val directory = localFile(uri)
      require(directory.isDirectory) { "Source is not a directory" }
      val children = directory.listFiles() ?: throw IOException("Cannot enumerate directory")
      return children.map { child ->
        requireWithin(directory, child.canonicalFile)
        mapOf("name" to child.name, "uri" to Uri.fromFile(child).toString(),
          "isDirectory" to child.isDirectory, "size" to if (child.isFile) child.length() else null,
          "identity" to stableIdentity(Uri.fromFile(child)))
      }.sortedBy { it["name"] as String }
    }
    require(DocumentsContract.isTreeUri(uri)) { "Directory enumeration requires a persisted tree grant" }
    val directoryUri = documentUri(uri)
    require(metadata(directoryUri)["isDirectory"] == true) { "Source is not a directory" }
    val childQuery = DocumentsContract.buildChildDocumentsUriUsingTree(uri, DocumentsContract.getDocumentId(directoryUri))
    val cursor = resolver.query(childQuery, projection, null, null, null) ?: throw IOException("Provider cannot enumerate directory")
    val result = mutableListOf<Map<String, Any?>>()
    cursor.use {
      requireCompleteQuery(it)
      while (it.moveToNext()) {
        val id = it.getString(it.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_DOCUMENT_ID))
        result.add(cursorEntry(it, DocumentsContract.buildDocumentUriUsingTree(uri, id)))
      }
    }
    return result.sortedBy { it["name"] as String }
  }

  private fun requireCompleteQuery(cursor: android.database.Cursor) {
    val error = cursor.extras.getString(DocumentsContract.EXTRA_ERROR)
    if (!error.isNullOrBlank()) throw IOException("Provider query failed: $error")
    if (cursor.extras.getBoolean(DocumentsContract.EXTRA_LOADING, false)) {
      throw IOException("Provider directory is still loading; retry after it is available")
    }
  }

  private fun relativeComponents(path: String): List<String> {
    require(!path.startsWith("/") && !path.contains('\\') && !path.contains('\u0000') && !path.substringBefore('/').contains(':')) { "Invalid relative path" }
    val result = mutableListOf<String>()
    for (component in path.split('/')) {
      when (component) {
        "", "." -> Unit
        ".." -> { require(result.isNotEmpty()) { "Relative path leaves authorized root" }; result.removeAt(result.lastIndex) }
        else -> result.add(component)
      }
    }
    return result
  }
}
